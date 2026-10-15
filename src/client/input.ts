import type { Camera } from './camera';
import { panBy, screenToWorld, zoomAt } from './camera';
import {
  CONSTANT_POINTER_PRESSURE,
  PALM_REJECTION_MS,
  WHEEL_LINE_HEIGHT_PX,
  WHEEL_ZOOM_SENSITIVITY,
} from './config';
import type { PointerInfo, Tool } from './tools/types';

/** マウスの主ボタン・中ボタン(PointerEvent.button) */
const MOUSE_BUTTON_PRIMARY = 0;
const MOUSE_BUTTON_MIDDLE = 1;

const POINTER_TYPE_PEN = 'pen';
const POINTER_TYPE_TOUCH = 'touch';

export type InputDeps = {
  canvas: HTMLCanvasElement;
  getTool(): Tool;
  /** 現在のツールが編集操作か(パンツールは false) */
  toolEdits(): boolean;
  canEdit(): boolean;
  getCamera(): Camera;
  setCamera(c: Camera): void;
  isSpaceHeld(): boolean;
  /**
   * ポインタが押される直前に呼ぶ。true を返したらその押下は消費済みとして無視する
   * (テキスト編集中に外側をタップして確定する場合など)
   */
  beforePointerDown(): boolean;
};

export type Input = {
  /** 進行中のツール操作を取り消す */
  cancel(): void;
};

type Mode =
  | { kind: 'idle' }
  | { kind: 'tool'; pointerId: number; pointerType: string; tool: Tool }
  | { kind: 'pan'; pointerId: number; pointerType: string; sx: number; sy: number }
  | { kind: 'pinch'; a: number; b: number; midX: number; midY: number; dist: number }
  /** ピンチ終了後、すべての指が離れるまで何もしない */
  | { kind: 'suppressed' };

type ScreenPoint = { sx: number; sy: number };

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function createInput(deps: InputDeps): Input {
  const { canvas } = deps;
  let mode: Mode = { kind: 'idle' };
  /** 受け付けているタッチポインタの現在位置 */
  const touches = new Map<number, ScreenPoint>();
  /** パームリジェクションで無視しているポインタ */
  const ignored = new Set<number>();
  let penDown = false;
  let lastPenUpAt = Number.NEGATIVE_INFINITY;

  function screenPoint(e: PointerEvent | WheelEvent): ScreenPoint {
    const rect = canvas.getBoundingClientRect();
    return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
  }

  function pointerInfo(e: PointerEvent, shiftKey: boolean): PointerInfo {
    const { sx, sy } = screenPoint(e);
    const world = screenToWorld(deps.getCamera(), sx, sy);
    return {
      x: world.x,
      y: world.y,
      sx,
      sy,
      pressure: e.pointerType === POINTER_TYPE_PEN ? clamp01(e.pressure) : CONSTANT_POINTER_PRESSURE,
      pointerType: e.pointerType,
      shiftKey,
    };
  }

  function cancelCurrent(): void {
    if (mode.kind === 'tool') mode.tool.onCancel();
    mode = { kind: 'idle' };
  }

  function pinchMetrics(a: ScreenPoint, b: ScreenPoint): { midX: number; midY: number; dist: number } {
    return {
      midX: (a.sx + b.sx) / 2,
      midY: (a.sy + b.sy) / 2,
      dist: Math.hypot(a.sx - b.sx, a.sy - b.sy),
    };
  }

  function startPinch(): void {
    const ids = [...touches.keys()];
    const a = ids[0];
    const b = ids[1];
    if (a === undefined || b === undefined) return;
    const pa = touches.get(a);
    const pb = touches.get(b);
    if (!pa || !pb) return;
    cancelCurrent();
    mode = { kind: 'pinch', a, b, ...pinchMetrics(pa, pb) };
  }

  function updatePinch(): void {
    if (mode.kind !== 'pinch') return;
    const pa = touches.get(mode.a);
    const pb = touches.get(mode.b);
    if (!pa || !pb) return;
    const next = pinchMetrics(pa, pb);
    let camera = panBy(deps.getCamera(), next.midX - mode.midX, next.midY - mode.midY);
    if (mode.dist > 0 && next.dist > 0) {
      camera = zoomAt(camera, next.midX, next.midY, next.dist / mode.dist);
    }
    deps.setCamera(camera);
    mode = { ...mode, ...next };
  }

  function isPalmRejected(e: PointerEvent): boolean {
    if (e.pointerType !== POINTER_TYPE_TOUCH) return false;
    return penDown || e.timeStamp - lastPenUpAt < PALM_REJECTION_MS;
  }

  function onPointerDown(e: PointerEvent): void {
    if (isPalmRejected(e)) {
      ignored.add(e.pointerId);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== MOUSE_BUTTON_PRIMARY && e.button !== MOUSE_BUTTON_MIDDLE) {
      return;
    }
    if (e.pointerType === POINTER_TYPE_PEN) {
      penDown = true;
      // ペンより先に触れていた手のひら(タッチ)の操作は破棄する
      if (touches.size > 0) {
        for (const id of touches.keys()) ignored.add(id);
        touches.clear();
        if (mode.kind !== 'idle') cancelCurrent();
      }
    }
    if (e.pointerType === POINTER_TYPE_TOUCH) {
      // 3本目以降の指は無視する
      if (touches.size >= 2) {
        ignored.add(e.pointerId);
        return;
      }
      touches.set(e.pointerId, screenPoint(e));
      if (touches.size === 2) {
        // 進行中の操作(描きかけの線など)を破棄してピンチに切り替える
        startPinch();
        return;
      }
    }
    canvas.setPointerCapture(e.pointerId);

    if (mode.kind !== 'idle') return;
    if (deps.beforePointerDown()) return;

    const { sx, sy } = screenPoint(e);
    if (e.button === MOUSE_BUTTON_MIDDLE || deps.isSpaceHeld()) {
      mode = { kind: 'pan', pointerId: e.pointerId, pointerType: e.pointerType, sx, sy };
      return;
    }
    if (deps.toolEdits() && !deps.canEdit()) return;
    const tool = deps.getTool();
    mode = { kind: 'tool', pointerId: e.pointerId, pointerType: e.pointerType, tool };
    tool.onDown(pointerInfo(e, e.shiftKey));
  }

  function onPointerMove(e: PointerEvent): void {
    if (ignored.has(e.pointerId)) return;
    if (touches.has(e.pointerId)) touches.set(e.pointerId, screenPoint(e));

    switch (mode.kind) {
      case 'pinch':
        if (e.pointerId === mode.a || e.pointerId === mode.b) updatePinch();
        return;
      case 'pan': {
        if (e.pointerId !== mode.pointerId) return;
        const { sx, sy } = screenPoint(e);
        deps.setCamera(panBy(deps.getCamera(), sx - mode.sx, sy - mode.sy));
        mode = { ...mode, sx, sy };
        return;
      }
      case 'tool': {
        if (e.pointerId !== mode.pointerId) return;
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const samples = events.length > 0 ? events : [e];
        for (const sample of samples) mode.tool.onMove(pointerInfo(sample, e.shiftKey));
        return;
      }
      case 'idle':
      case 'suppressed':
        return;
    }
  }

  function onPointerEnd(e: PointerEvent, cancelled: boolean): void {
    if (e.pointerType === POINTER_TYPE_PEN) {
      penDown = false;
      lastPenUpAt = e.timeStamp;
    }
    if (ignored.delete(e.pointerId)) return;
    touches.delete(e.pointerId);

    switch (mode.kind) {
      case 'pinch':
        if (e.pointerId === mode.a || e.pointerId === mode.b) {
          mode = touches.size > 0 ? { kind: 'suppressed' } : { kind: 'idle' };
        }
        return;
      case 'suppressed':
        if (touches.size === 0) mode = { kind: 'idle' };
        return;
      case 'pan':
        if (e.pointerId === mode.pointerId) mode = { kind: 'idle' };
        return;
      case 'tool': {
        if (e.pointerId !== mode.pointerId) return;
        const { tool } = mode;
        mode = { kind: 'idle' };
        if (cancelled) tool.onCancel();
        else tool.onUp(pointerInfo(e, e.shiftKey));
        return;
      }
      case 'idle':
        return;
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const unit =
      e.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? WHEEL_LINE_HEIGHT_PX
        : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? canvas.clientHeight
          : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const camera = deps.getCamera();
    if (e.ctrlKey || e.metaKey) {
      const { sx, sy } = screenPoint(e);
      deps.setCamera(zoomAt(camera, sx, sy, Math.exp(-dy * WHEEL_ZOOM_SENSITIVITY)));
    } else {
      deps.setCamera(panBy(camera, -dx, -dy));
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', (e) => onPointerEnd(e, false));
  canvas.addEventListener('pointercancel', (e) => onPointerEnd(e, true));
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // タッチ後に合成される mouse / click イベントで textarea のフォーカスが外れないようにする
  canvas.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });

  return {
    cancel() {
      cancelCurrent();
    },
  };
}
