import { applyOp, type ObjectMap } from '../shared/apply.ts';
import { createId } from '../shared/ids.ts';
import type { LineStyle, ObjectChanges, Op, Point, StrokeObject, TextObject, WhiteboardObject } from '../shared/model.ts';
import { textFontSize } from '../shared/model.ts';
import { boundsIntersect, hitTest, objectBounds, rectFromPoints, type Bounds } from './geometry.ts';
import { drawObject, drawRubberBand, drawSelection, measureText } from './render.ts';
import { openTextEditor, type TextEditorHandle } from './textEditor.ts';

export type Tool = 'pen' | 'eraser' | 'select' | 'text';

export interface BoardState {
  tool: Tool;
  color: string;
  width: number;
  lineStyle: LineStyle;
  multiSelect: boolean;
  selectedCount: number;
}

export interface BoardOptions {
  canvas: HTMLCanvasElement;
  /** Element that the canvas fills. The text editor overlay is placed inside it. */
  stage: HTMLElement;
  send: (op: Op) => void;
  onStateChange: (state: BoardState) => void;
}

export interface Board {
  getObjects: () => WhiteboardObject[];
  setTool: (tool: Tool) => void;
  setColor: (color: string) => void;
  setWidth: (width: number) => void;
  setLineStyle: (lineStyle: LineStyle) => void;
  setMultiSelect: (enabled: boolean) => void;
  deleteSelected: () => void;
  clearAll: () => void;
  selectAll: () => void;
  clearSelection: () => void;
  loadSnapshot: (objects: WhiteboardObject[]) => void;
  applyRemote: (op: Op) => void;
  notify: () => void;
}

/** Interval in ms within which a second tap on the same text starts editing it. */
const DOUBLE_TAP_MS = 350;
const MOUSE_PRIMARY_BUTTON = 0;

type Gesture =
  | { kind: 'none' }
  | { kind: 'draw'; stroke: StrokeObject; pending: Point[] }
  | { kind: 'erase' }
  | { kind: 'move'; last: Point }
  | { kind: 'marquee'; start: Point; base: string[]; rect: Bounds };

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is not supported in this browser');
  return context;
}

export function createBoard(options: BoardOptions): Board {
  const { canvas, stage, send, onStateChange } = options;
  const context = requireContext(canvas);

  const objects: ObjectMap = new Map();
  const selection = new Set<string>();

  let tool: Tool = 'pen';
  let color = '#111827';
  let width = 4;
  let lineStyle: LineStyle = 'solid';
  let multiSelect = false;

  let gesture: Gesture = { kind: 'none' };
  let activePointerId: number | null = null;
  let penActive = false;
  let lastTap: { id: string; time: number } | null = null;

  let editor: TextEditorHandle | null = null;
  let editingId: string | null = null;

  let dpr = 1;
  let renderQueued = false;
  let flushQueued = false;

  function scheduleRender(): void {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  function render(): void {
    renderQueued = false;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (const object of objects.values()) {
      if (object.id !== editingId) drawObject(context, object);
    }
    for (const id of selection) {
      const object = objects.get(id);
      if (object) drawSelection(context, objectBounds(object, measureText));
    }
    if (gesture.kind === 'marquee') drawRubberBand(context, gesture.rect);
  }

  function notify(): void {
    onStateChange({ tool, color, width, lineStyle, multiSelect, selectedCount: selection.size });
  }

  function setSelection(ids: Iterable<string>): void {
    selection.clear();
    for (const id of ids) {
      if (objects.has(id)) selection.add(id);
    }
    notify();
    scheduleRender();
  }

  function selectAll(): void {
    setSelection(objects.keys());
  }

  function pruneSelection(): void {
    for (const id of [...selection]) {
      if (!objects.has(id)) selection.delete(id);
    }
  }

  /** Applies the op locally and sends it to the server. */
  function commit(op: Op): void {
    applyOp(objects, op);
    send(op);
    scheduleRender();
  }

  function pointFrom(event: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      // Only pens report real pressure; mouse and touch use a neutral value.
      p: event.pointerType === 'pen' ? event.pressure : 0.5,
    };
  }

  function topObjectAt(point: Point): WhiteboardObject | undefined {
    const list = [...objects.values()];
    for (let i = list.length - 1; i >= 0; i--) {
      const object = list[i];
      if (object && hitTest(object, point.x, point.y, measureText)) return object;
    }
    return undefined;
  }

  // ---- Drawing -----------------------------------------------------------

  function startStroke(point: Point, pressure: boolean): void {
    const stroke: StrokeObject = {
      kind: 'stroke',
      id: createId(),
      color,
      width,
      lineStyle,
      pressure,
      points: [point],
    };
    commit({ type: 'add', object: stroke });
    gesture = { kind: 'draw', stroke, pending: [] };
  }

  /** Sends points collected since the last flush. Streaming keeps other clients live while drawing. */
  function flushDraw(): void {
    flushQueued = false;
    if (gesture.kind !== 'draw' || gesture.pending.length === 0) return;
    send({ type: 'append', id: gesture.stroke.id, points: gesture.pending });
    gesture.pending = [];
  }

  function scheduleFlush(): void {
    if (flushQueued) return;
    flushQueued = true;
    requestAnimationFrame(flushDraw);
  }

  // ---- Eraser ------------------------------------------------------------

  function eraseAt(point: Point): void {
    const hits: string[] = [];
    for (const object of objects.values()) {
      if (hitTest(object, point.x, point.y, measureText)) hits.push(object.id);
    }
    if (hits.length === 0) return;
    commit({ type: 'remove', ids: hits });
    pruneSelection();
    notify();
  }

  // ---- Text --------------------------------------------------------------

  function openNewText(point: Point): void {
    const at = { x: point.x, y: point.y };
    const fontSize = textFontSize(width);
    editor = openTextEditor({
      container: stage,
      x: at.x,
      y: at.y,
      initial: '',
      color,
      fontSize,
      onSubmit: (text) => {
        editor = null;
        if (text.trim() === '') return;
        const object: TextObject = {
          kind: 'text',
          id: createId(),
          x: at.x,
          y: at.y,
          text,
          color,
          width,
          lineStyle,
        };
        commit({ type: 'add', object });
      },
      onCancel: () => {
        editor = null;
      },
    });
  }

  function openEditText(object: TextObject): void {
    editingId = object.id;
    editor = openTextEditor({
      container: stage,
      x: object.x,
      y: object.y,
      initial: object.text,
      color: object.color,
      fontSize: textFontSize(object.width),
      onSubmit: (text) => {
        editor = null;
        editingId = null;
        if (text.trim() === '') {
          commit({ type: 'remove', ids: [object.id] });
          pruneSelection();
          notify();
        } else if (text !== object.text) {
          commit({ type: 'patch', id: object.id, changes: { text } });
        }
        scheduleRender();
      },
      onCancel: () => {
        editor = null;
        editingId = null;
        scheduleRender();
      },
    });
    scheduleRender();
  }

  // ---- Select / move / marquee ------------------------------------------

  function selectDown(point: Point, additive: boolean): void {
    const hit = topObjectAt(point);
    const now = performance.now();

    if (!hit) {
      lastTap = null;
      const base = additive ? [...selection] : [];
      setSelection(base);
      gesture = { kind: 'marquee', start: point, base, rect: rectFromPoints(point.x, point.y, point.x, point.y) };
      return;
    }

    if (hit.kind === 'text' && lastTap?.id === hit.id && now - lastTap.time < DOUBLE_TAP_MS && !additive) {
      lastTap = null;
      openEditText(hit);
      gesture = { kind: 'none' };
      return;
    }
    lastTap = { id: hit.id, time: now };

    if (additive) {
      if (selection.has(hit.id)) selection.delete(hit.id);
      else selection.add(hit.id);
      notify();
      scheduleRender();
      if (!selection.has(hit.id)) {
        gesture = { kind: 'none' };
        return;
      }
    } else if (!selection.has(hit.id)) {
      setSelection([hit.id]);
    }
    gesture = { kind: 'move', last: point };
  }

  function marqueeMove(point: Point): void {
    if (gesture.kind !== 'marquee') return;
    const rect = rectFromPoints(gesture.start.x, gesture.start.y, point.x, point.y);
    gesture.rect = rect;
    const inside: string[] = [];
    for (const object of objects.values()) {
      if (boundsIntersect(objectBounds(object, measureText), rect)) inside.push(object.id);
    }
    setSelection([...gesture.base, ...inside]);
  }

  function moveSelection(point: Point): void {
    if (gesture.kind !== 'move' || selection.size === 0) return;
    const dx = point.x - gesture.last.x;
    const dy = point.y - gesture.last.y;
    if (dx === 0 && dy === 0) return;
    commit({ type: 'move', ids: [...selection], dx, dy });
    gesture.last = point;
  }

  // ---- Pointer handlers --------------------------------------------------

  function onPointerDown(event: PointerEvent): void {
    // Only one pointer drives the board at a time; extra fingers are ignored.
    if (activePointerId !== null) return;
    if (event.pointerType === 'mouse' && event.button !== MOUSE_PRIMARY_BUTTON) return;
    // Palm rejection: while a pen is in use, touches are ignored.
    if (event.pointerType === 'touch' && penActive) return;
    if (event.pointerType === 'pen') penActive = true;

    event.preventDefault();
    if (editor) editor.commit();

    activePointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const point = pointFrom(event);

    switch (tool) {
      case 'pen':
        startStroke(point, event.pointerType === 'pen');
        break;
      case 'eraser':
        gesture = { kind: 'erase' };
        eraseAt(point);
        break;
      case 'text':
        openNewText(point);
        break;
      case 'select':
        selectDown(point, multiSelect || event.shiftKey);
        break;
    }
    scheduleRender();
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    // Coalesced events give smoother lines for pen and touch input.
    const samples = event.getCoalescedEvents();
    const sampleEvents = samples.length > 0 ? samples : [event];

    switch (gesture.kind) {
      case 'draw':
        for (const sample of sampleEvents) {
          const point = pointFrom(sample);
          gesture.stroke.points.push(point);
          gesture.pending.push(point);
        }
        scheduleFlush();
        scheduleRender();
        break;
      case 'erase':
        eraseAt(pointFrom(event));
        break;
      case 'move':
        moveSelection(pointFrom(event));
        break;
      case 'marquee':
        marqueeMove(pointFrom(event));
        break;
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== activePointerId) return;
    if (gesture.kind === 'draw') flushDraw();
    gesture = { kind: 'none' };
    activePointerId = null;
    if (event.pointerType === 'pen') penActive = false;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    scheduleRender();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  // Long-press on touch devices opens the context menu; it would interrupt drawing.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (isEditableTarget(event.target)) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selection.size === 0) return;
      event.preventDefault();
      deleteSelected();
    } else if (event.key === 'Escape') {
      setSelection([]);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAll();
    }
  });

  function isEditableTarget(target: EventTarget | null): boolean {
    return target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement;
  }

  function resize(): void {
    dpr = window.devicePixelRatio;
    const rect = stage.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    scheduleRender();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- Public API --------------------------------------------------------

  function applyChangesToSelection(changes: ObjectChanges): void {
    for (const id of [...selection]) commit({ type: 'patch', id, changes });
  }

  function deleteSelected(): void {
    if (selection.size === 0) return;
    commit({ type: 'remove', ids: [...selection] });
    selection.clear();
    notify();
  }

  return {
    getObjects: () => [...objects.values()],

    setTool(next) {
      tool = next;
      if (editor) editor.commit();
      notify();
    },

    setColor(next) {
      color = next;
      applyChangesToSelection({ color: next });
      notify();
    },

    setWidth(next) {
      width = next;
      applyChangesToSelection({ width: next });
      notify();
    },

    setLineStyle(next) {
      lineStyle = next;
      applyChangesToSelection({ lineStyle: next });
      notify();
    },

    setMultiSelect(enabled) {
      multiSelect = enabled;
      notify();
    },

    deleteSelected,

    clearAll() {
      if (objects.size === 0) return;
      commit({ type: 'clear' });
      selection.clear();
      notify();
    },

    selectAll,

    clearSelection() {
      setSelection([]);
    },

    loadSnapshot(list) {
      objects.clear();
      for (const object of list) objects.set(object.id, object);
      // A stroke that is still being drawn stays visible even if the snapshot predates it.
      if (gesture.kind === 'draw' && !objects.has(gesture.stroke.id)) {
        objects.set(gesture.stroke.id, gesture.stroke);
      }
      pruneSelection();
      notify();
      scheduleRender();
    },

    applyRemote(op) {
      applyOp(objects, op);
      if (op.type === 'remove' || op.type === 'clear') {
        pruneSelection();
        notify();
      }
      scheduleRender();
    },

    notify,
  };
}
