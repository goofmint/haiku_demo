import type { Op, WhiteboardObject } from './model.ts';

export type ObjectMap = Map<string, WhiteboardObject>;

/**
 * Applies one op to the object map in place.
 * Used by both the server (authoritative state) and the client (optimistic local state),
 * so both sides always apply the same rules. Unknown ids are ignored.
 */
export function applyOp(objects: ObjectMap, op: Op): void {
  switch (op.type) {
    case 'add':
      objects.set(op.object.id, op.object);
      return;

    case 'append': {
      const target = objects.get(op.id);
      if (target?.kind === 'stroke') {
        target.points.push(...op.points);
      }
      return;
    }

    case 'move':
      for (const id of op.ids) {
        const target = objects.get(id);
        if (!target) continue;
        if (target.kind === 'text') {
          target.x += op.dx;
          target.y += op.dy;
        } else {
          for (const point of target.points) {
            point.x += op.dx;
            point.y += op.dy;
          }
        }
      }
      return;

    case 'patch': {
      const target = objects.get(op.id);
      if (!target) return;
      const { changes } = op;
      if (changes.color !== undefined) target.color = changes.color;
      if (changes.width !== undefined) target.width = changes.width;
      if (changes.lineStyle !== undefined) target.lineStyle = changes.lineStyle;
      if (changes.text !== undefined && target.kind === 'text') target.text = changes.text;
      return;
    }

    case 'remove':
      for (const id of op.ids) objects.delete(id);
      return;

    case 'clear':
      objects.clear();
      return;
  }
}
