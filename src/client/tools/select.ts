import type { BoardObject } from '../../shared/types';
import { DOUBLE_TAP_MS, DOUBLE_TAP_PX, HIT_TOLERANCE_PX, TAP_MOVE_TOLERANCE_PX } from '../config';
import type { Rect } from '../geometry';
import { expandRect, hitTest, objectBounds, rectsIntersect } from '../geometry';
import type { EditorContext, PointerInfo, Tool } from './types';

type Gesture =
  | { kind: 'none' }
  | {
      kind: 'drag';
      ids: string[];
      /** 実際に移動を始めたか(タップ判定の許容値を超えたか) */
      moving: boolean;
      last: { x: number; y: number };
      totalDx: number;
      totalDy: number;
    }
  | { kind: 'marquee'; start: { x: number; y: number }; base: Set<string> };

type Tap = { time: number; sx: number; sy: number; id: string };

function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

export function createSelectTool(ctx: EditorContext): Tool {
  let gesture: Gesture = { kind: 'none' };
  /** 押した位置(画面座標)。タップかドラッグかの判定に使う */
  let downScreen = { sx: 0, sy: 0 };
  let movedBeyondTap = false;
  /** 押した位置にあった最前面のオブジェクト */
  let downHit: BoardObject | null = null;
  /** 直前のタップ(ダブルタップ判定用) */
  let lastTap: Tap | null = null;

  function tolerance(): number {
    return HIT_TOLERANCE_PX / ctx.getCamera().zoom;
  }

  /** 選択中オブジェクトのバウンディングボックス内か */
  function insideSelection(x: number, y: number): boolean {
    const selection = ctx.getSelection();
    if (selection.size === 0) return false;
    const tol = tolerance();
    for (const obj of ctx.visibleObjects()) {
      if (!selection.has(obj.id)) continue;
      if (containsPoint(expandRect(objectBounds(obj, ctx.measure), tol), x, y)) return true;
    }
    return false;
  }

  function startDrag(ids: Iterable<string>, p: PointerInfo): void {
    gesture = {
      kind: 'drag',
      ids: [...ids],
      moving: false,
      last: { x: p.x, y: p.y },
      totalDx: 0,
      totalDy: 0,
    };
  }

  function isDoubleTap(p: PointerInfo, id: string): boolean {
    if (!lastTap || lastTap.id !== id) return false;
    if (performance.now() - lastTap.time > DOUBLE_TAP_MS) return false;
    return Math.hypot(p.sx - lastTap.sx, p.sy - lastTap.sy) <= DOUBLE_TAP_PX;
  }

  function handleTap(p: PointerInfo): void {
    const hit = downHit;
    if (!hit) {
      lastTap = null;
      return;
    }
    if (hit.kind === 'text' && isDoubleTap(p, hit.id)) {
      lastTap = null;
      const current = ctx.board.get(hit.id);
      if (current && current.kind === 'text') ctx.openTextEditor({ kind: 'existing', object: current });
      return;
    }
    lastTap = { time: performance.now(), sx: p.sx, sy: p.sy, id: hit.id };
  }

  return {
    onDown(p) {
      downScreen = { sx: p.sx, sy: p.sy };
      movedBeyondTap = false;
      downHit = hitTest(ctx.visibleObjects(), p.x, p.y, tolerance(), ctx.measure);

      if (!p.shiftKey && insideSelection(p.x, p.y)) {
        startDrag(ctx.getSelection(), p);
        return;
      }
      if (downHit) {
        const id = downHit.id;
        if (p.shiftKey) {
          const next = new Set(ctx.getSelection());
          if (next.has(id)) {
            next.delete(id);
            ctx.setSelection(next);
            gesture = { kind: 'none' };
            return;
          }
          next.add(id);
          ctx.setSelection(next);
        } else {
          ctx.setSelection([id]);
        }
        startDrag(ctx.getSelection(), p);
        return;
      }
      const base = p.shiftKey ? new Set(ctx.getSelection()) : new Set<string>();
      if (!p.shiftKey) ctx.setSelection([]);
      gesture = { kind: 'marquee', start: { x: p.x, y: p.y }, base };
    },

    onMove(p) {
      if (!movedBeyondTap) {
        movedBeyondTap =
          Math.hypot(p.sx - downScreen.sx, p.sy - downScreen.sy) > TAP_MOVE_TOLERANCE_PX;
        if (!movedBeyondTap) return;
      }
      if (gesture.kind === 'drag') {
        gesture.moving = true;
        const dx = p.x - gesture.last.x;
        const dy = p.y - gesture.last.y;
        gesture.last = { x: p.x, y: p.y };
        if (dx === 0 && dy === 0) return;
        gesture.totalDx += dx;
        gesture.totalDy += dy;
        // ドラッグ中はローカルのみ反映し、離した時に move を1回送る
        ctx.board.apply({ type: 'move', ids: gesture.ids, dx, dy });
      } else if (gesture.kind === 'marquee') {
        ctx.marquee = rectFrom(gesture.start, p);
        ctx.requestRender();
      }
    },

    onUp(p) {
      const g = gesture;
      gesture = { kind: 'none' };
      if (g.kind === 'drag' && g.moving) {
        lastTap = null;
        if (g.totalDx !== 0 || g.totalDy !== 0) {
          const op = { type: 'move', ids: g.ids, dx: g.totalDx, dy: g.totalDy } as const;
          ctx.publish(op, op);
        }
        return;
      }
      if (g.kind === 'marquee') {
        const rect = ctx.marquee;
        ctx.marquee = null;
        ctx.requestRender();
        if (movedBeyondTap && rect) {
          lastTap = null;
          const next = new Set(g.base);
          for (const obj of ctx.visibleObjects()) {
            if (rectsIntersect(objectBounds(obj, ctx.measure), rect)) next.add(obj.id);
          }
          ctx.setSelection(next);
          return;
        }
      }
      handleTap(p);
    },

    onCancel() {
      const g = gesture;
      gesture = { kind: 'none' };
      lastTap = null;
      if (g.kind === 'drag' && (g.totalDx !== 0 || g.totalDy !== 0)) {
        // ローカルだけに反映していた移動を元に戻す
        ctx.board.apply({ type: 'move', ids: g.ids, dx: -g.totalDx, dy: -g.totalDy });
      }
      if (ctx.marquee) {
        ctx.marquee = null;
        ctx.requestRender();
      }
    },
  };
}
