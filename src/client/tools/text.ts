import type { TextObject } from '../../shared/types';
import { HIT_TOLERANCE_PX, TAP_MOVE_TOLERANCE_PX } from '../config';
import { hitTest } from '../geometry';
import type { EditorContext, Tool } from './types';

export function createTextTool(ctx: EditorContext): Tool {
  let down: { sx: number; sy: number } | null = null;

  return {
    onDown(p) {
      down = { sx: p.sx, sy: p.sy };
    },
    onMove() {
      // テキストツールはドラッグを使わない
    },
    onUp(p) {
      const start = down;
      down = null;
      if (!start) return;
      if (Math.hypot(p.sx - start.sx, p.sy - start.sy) > TAP_MOVE_TOLERANCE_PX) return;
      const texts = ctx.visibleObjects().filter((o): o is TextObject => o.kind === 'text');
      const tolerance = HIT_TOLERANCE_PX / ctx.getCamera().zoom;
      const hit = hitTest(texts, p.x, p.y, tolerance, ctx.measure);
      // iOS でキーボードを出すため、pointerup の処理中に同期的に開く(focus する)
      if (hit && hit.kind === 'text') ctx.openTextEditor({ kind: 'existing', object: hit });
      else ctx.openTextEditor({ kind: 'new', x: p.x, y: p.y });
    },
    onCancel() {
      down = null;
    },
  };
}
