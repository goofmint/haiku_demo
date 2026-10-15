import { DEFAULT_PRESSURE, ERASER_RADIUS, HIT_TOLERANCE } from '../shared/constants.js';
import type { BoardObject, Point, StrokeObject } from '../shared/types.js';
import type { BoardState } from './state.js';
import type { Renderer } from './renderer.js';
import { boundsOf, hitTest, normalizeRect, rectIntersects } from './geometry.js';
import type { Rect, Vec } from './geometry.js';
import { generateId } from '../shared/id.js';

const MIN_POINT_DISTANCE_PX = 1;
const TINY_RECT_PX = 3;

export type ToolDeps = {
  state: BoardState;
  renderer: Renderer;
  addObject(obj: BoardObject): void;                 // applies locally + sends (wired in main)
  deleteObjects(ids: string[]): void;                 // applies locally + sends
  sendMove(ids: string[], dx: number, dy: number): void; // sends only; state was already moved locally during drag
  openTextInput(x: number, y: number): void;
  requestRender(): void;
};

export type ToolHandlers = {
  getInProgressStroke(): StrokeObject | null;
  getSelectionRect(): Rect | null;
  detach(): void;
};

type Gesture =
  | { kind: 'pen'; pointerId: number; stroke: StrokeObject }
  | { kind: 'eraser'; pointerId: number }
  | { kind: 'drag'; pointerId: number; ids: string[]; last: Vec; total: Vec }
  | { kind: 'rubber'; pointerId: number; start: Vec; rect: Rect };

export function attachPointerHandlers(canvas: HTMLCanvasElement, deps: ToolDeps): ToolHandlers {
  const { state, renderer } = deps;
  const measure = renderer.measureText;
  let gesture: Gesture | null = null;

  function toPoint(e: PointerEvent): Point {
    const box = canvas.getBoundingClientRect();
    const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : DEFAULT_PRESSURE;
    return { x: e.clientX - box.left, y: e.clientY - box.top, p: pressure };
  }

  function eventsOf(e: PointerEvent): PointerEvent[] {
    if (typeof e.getCoalescedEvents !== 'function') return [e];
    const list = e.getCoalescedEvents();
    return list.length > 0 ? list : [e];
  }

  function hitTopmost(pt: Vec): BoardObject | undefined {
    const objects = state.getObjects();
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i];
      if (hitTest(o, pt, HIT_TOLERANCE, measure)) return o;
    }
    return undefined;
  }

  function eraseAt(pts: Vec[]): void {
    const ids = new Set<string>();
    for (const pt of pts) {
      for (const o of state.getObjects()) {
        if (hitTest(o, pt, ERASER_RADIUS, measure)) ids.add(o.id);
      }
    }
    if (ids.size > 0) deps.deleteObjects(Array.from(ids));
  }

  function applyMove(g: Gesture, e: PointerEvent): void {
    switch (g.kind) {
      case 'pen': {
        let added = false;
        for (const ev of eventsOf(e)) {
          const pt = toPoint(ev);
          const last = g.stroke.points[g.stroke.points.length - 1];
          if (Math.hypot(pt.x - last.x, pt.y - last.y) < MIN_POINT_DISTANCE_PX) continue;
          g.stroke.points.push(pt);
          added = true;
        }
        if (added) deps.requestRender();
        return;
      }
      case 'eraser':
        eraseAt(eventsOf(e).map((ev) => toPoint(ev)));
        return;
      case 'drag': {
        for (const ev of eventsOf(e)) {
          const pt = toPoint(ev);
          const dx = pt.x - g.last.x;
          const dy = pt.y - g.last.y;
          if (dx === 0 && dy === 0) continue;
          state.moveObjects(g.ids, dx, dy);
          g.total.x += dx;
          g.total.y += dy;
          g.last = pt;
        }
        return;
      }
      case 'rubber':
        g.rect = normalizeRect(g.start, toPoint(e));
        deps.requestRender();
        return;
    }
  }

  // Called after the gesture has been detached from `gesture`. `e` is the up event, or null when cancelled.
  function finishGesture(g: Gesture, e: PointerEvent | null): void {
    switch (g.kind) {
      case 'pen':
        if (e !== null) {
          applyMove(g, e);
          deps.addObject(g.stroke);
        }
        break;
      case 'eraser':
        break;
      case 'drag':
        if (e !== null) applyMove(g, e);
        if (g.total.x !== 0 || g.total.y !== 0) deps.sendMove(g.ids, g.total.x, g.total.y);
        break;
      case 'rubber': {
        if (e !== null) applyMove(g, e);
        const r = g.rect;
        if (Math.max(r.w, r.h) < TINY_RECT_PX) {
          state.setSelection([]);
        } else {
          const ids = state
            .getObjects()
            .filter((o) => rectIntersects(boundsOf(o, measure), r))
            .map((o) => o.id);
          state.setSelection(ids);
        }
        break;
      }
    }
    deps.requestRender();
  }

  function onPointerDown(e: PointerEvent): void {
    if (gesture !== null || !e.isPrimary) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const pt = toPoint(e);

    switch (state.getTool()) {
      case 'pen':
        gesture = {
          kind: 'pen',
          pointerId: e.pointerId,
          stroke: {
            id: generateId(),
            kind: 'stroke',
            points: [pt],
            color: state.getColor(),
            width: state.getWidth(),
            lineStyle: state.getLineStyle(),
          },
        };
        deps.requestRender();
        return;
      case 'eraser':
        gesture = { kind: 'eraser', pointerId: e.pointerId };
        eraseAt([pt]);
        return;
      case 'select': {
        const hit = hitTopmost(pt);
        if (hit === undefined) {
          gesture = { kind: 'rubber', pointerId: e.pointerId, start: pt, rect: { x: pt.x, y: pt.y, w: 0, h: 0 } };
          deps.requestRender();
          return;
        }
        if (!state.getSelectedIds().has(hit.id)) state.setSelection([hit.id]);
        gesture = {
          kind: 'drag',
          pointerId: e.pointerId,
          ids: Array.from(state.getSelectedIds()),
          last: pt,
          total: { x: 0, y: 0 },
        };
        return;
      }
      case 'text':
        deps.openTextInput(pt.x, pt.y);
        return;
    }
  }

  function onPointerMove(e: PointerEvent): void {
    const g = gesture;
    if (g === null || g.pointerId !== e.pointerId) return;
    e.preventDefault();
    applyMove(g, e);
  }

  function onPointerUp(e: PointerEvent): void {
    const g = gesture;
    if (g === null || g.pointerId !== e.pointerId) return;
    e.preventDefault();
    gesture = null;
    finishGesture(g, e);
  }

  function onPointerCancel(e: PointerEvent): void {
    const g = gesture;
    if (g === null || g.pointerId !== e.pointerId) return;
    gesture = null;
    finishGesture(g, null);
  }

  // lostpointercapture also fires after pointerup; by then gesture is already null, so this is a no-op in that case.
  function onLostCapture(e: PointerEvent): void {
    onPointerCancel(e);
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('lostpointercapture', onLostCapture);

  return {
    getInProgressStroke() {
      const g = gesture;
      return g !== null && g.kind === 'pen' ? g.stroke : null;
    },
    getSelectionRect() {
      const g = gesture;
      return g !== null && g.kind === 'rubber' ? g.rect : null;
    },
    detach() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
      const g = gesture;
      gesture = null;
      if (g !== null) finishGesture(g, null);
    },
  };
}
