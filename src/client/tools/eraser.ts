import type { BoardObject } from '../../shared/types';
import { cloneObject } from '../board';
import { ERASER_RADIUS_PX } from '../config';
import { hitTest } from '../geometry';
import type { EditorContext, PointerInfo, Tool } from './types';

/** なぞり線分をサンプリングする間隔(半径に対する倍率) */
const SAMPLE_STEP_RADIUS_RATIO = 0.5;

export function createEraserTool(ctx: EditorContext): Tool {
  let last: { x: number; y: number } | null = null;
  /** このなぞりで消したオブジェクト(Undo 1回で戻す) */
  let removed: BoardObject[] = [];

  function radius(): number {
    return Math.max(ERASER_RADIUS_PX / ctx.getCamera().zoom, ctx.settings.width);
  }

  /** 線分 a→b を半径/2 間隔でサンプリングし、当たったものを即座に消す */
  function eraseSegment(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const r = radius();
    const step = r * SAMPLE_STEP_RADIUS_RATIO;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    let candidates = ctx.visibleObjects();
    const hits: BoardObject[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      for (let hit = hitTest(candidates, x, y, r, ctx.measure); hit; ) {
        const target = hit;
        hits.push(target);
        candidates = candidates.filter((o) => o !== target);
        hit = hitTest(candidates, x, y, r, ctx.measure);
      }
    }
    if (hits.length === 0) return;
    for (const obj of hits) removed.push(cloneObject(obj));
    const ids = hits.map((o) => o.id);
    ctx.board.apply({ type: 'remove', ids });
    ctx.send({ type: 'remove', ids });
  }

  function finish(): void {
    if (removed.length > 0) ctx.history.push({ type: 'remove', objects: removed });
    removed = [];
    last = null;
  }

  function current(p: PointerInfo): { x: number; y: number } {
    return { x: p.x, y: p.y };
  }

  return {
    onDown(p) {
      removed = [];
      last = current(p);
      eraseSegment(last, last);
    },
    onMove(p) {
      if (!last) return;
      const next = current(p);
      eraseSegment(last, next);
      last = next;
    },
    onUp() {
      finish();
    },
    onCancel() {
      // 既に消したものは送信済みなので、Undo できるよう履歴には積む
      finish();
    },
  };
}
