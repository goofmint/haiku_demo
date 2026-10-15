import { LIMITS } from '../../shared/limits';
import type { Point, StrokeObject } from '../../shared/types';
import type { EditorContext, PointerInfo, Tool } from './types';
import { createId } from '../id';

export function createPenTool(ctx: EditorContext): Tool {
  let current: StrokeObject | null = null;
  /** 上限点数に達して自動確定した後、ポインタが離れるまで入力を無視する */
  let exhausted = false;
  /** まだ送信していない点 */
  let pending: Point[] = [];
  let frameId: number | null = null;

  function toPoint(p: PointerInfo): Point {
    return { x: p.x, y: p.y, p: p.pressure };
  }

  function flush(): void {
    frameId = null;
    if (!current || pending.length === 0) return;
    ctx.send({ type: 'draft:points', id: current.id, points: pending });
    pending = [];
  }

  function scheduleFlush(): void {
    if (frameId === null) frameId = requestAnimationFrame(flush);
  }

  function stopFlush(): void {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    pending = [];
  }

  function reset(): void {
    stopFlush();
    current = null;
    ctx.ownDraft = null;
    ctx.requestRender();
  }

  /** 確定: add を送ってから draft:end を送る */
  function finish(): void {
    const stroke = current;
    if (!stroke) return;
    reset();
    ctx.commit({ type: 'add', objects: [stroke] }, { type: 'add', objects: [stroke] });
    ctx.send({ type: 'draft:end', id: stroke.id });
  }

  return {
    onDown(p) {
      if (current) reset();
      exhausted = false;
      const { settings } = ctx;
      const stroke: StrokeObject = {
        id: createId(),
        kind: 'stroke',
        points: [toPoint(p)],
        color: settings.color,
        width: settings.width,
        style: settings.style,
        pressure: settings.pressure && p.pointerType === 'pen',
      };
      current = stroke;
      ctx.ownDraft = stroke;
      ctx.send({ type: 'draft:start', object: stroke });
      ctx.requestRender();
    },
    onMove(p) {
      if (!current || exhausted) return;
      const point = toPoint(p);
      current.points.push(point);
      pending.push(point);
      if (current.points.length >= LIMITS.maxPointsPerStroke) {
        exhausted = true;
        finish();
        return;
      }
      scheduleFlush();
      ctx.requestRender();
    },
    onUp() {
      exhausted = false;
      finish();
    },
    onCancel() {
      exhausted = false;
      const stroke = current;
      if (!stroke) return;
      reset();
      ctx.send({ type: 'draft:end', id: stroke.id });
    },
  };
}
