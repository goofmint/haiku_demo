import { panBy } from '../camera';
import type { EditorContext, Tool } from './types';

export function createPanTool(ctx: EditorContext): Tool {
  let last: { sx: number; sy: number } | null = null;

  return {
    onDown(p) {
      last = { sx: p.sx, sy: p.sy };
    },
    onMove(p) {
      if (!last) return;
      ctx.setCamera(panBy(ctx.getCamera(), p.sx - last.sx, p.sy - last.sy));
      last = { sx: p.sx, sy: p.sy };
    },
    onUp() {
      last = null;
    },
    onCancel() {
      last = null;
    },
  };
}
