import type { BoardObject } from '../shared/types';

export type BoardOp =
  | { type: 'add'; objects: BoardObject[] }
  | { type: 'update'; object: BoardObject }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'remove'; ids: string[] }
  | { type: 'clear' };

export type Board = {
  /** 操作を適用する。無視ルールはサーバーの rooms と同じ */
  apply(op: BoardOp): void;
  /** 全オブジェクトを置き換える */
  reset(objects: BoardObject[]): void;
  /** 内部の参照を返す。呼び出し側は変更しないこと */
  get(id: string): BoardObject | undefined;
  /** 重なり順(下→上)。要素は内部の参照なので呼び出し側は変更しないこと */
  list(): BoardObject[];
  /** 変更通知を購読する。戻り値は購読解除関数 */
  subscribe(fn: () => void): () => void;
};

export function cloneObject(obj: BoardObject): BoardObject {
  if (obj.kind === 'stroke') {
    return { ...obj, points: obj.points.map((p) => ({ x: p.x, y: p.y, p: p.p })) };
  }
  return { ...obj };
}

function translated(obj: BoardObject, dx: number, dy: number): BoardObject {
  if (obj.kind === 'stroke') {
    return { ...obj, points: obj.points.map((p) => ({ x: p.x + dx, y: p.y + dy, p: p.p })) };
  }
  return { ...obj, x: obj.x + dx, y: obj.y + dy };
}

export function createBoard(): Board {
  /** Map の挿入順を重なり順とする */
  const objects = new Map<string, BoardObject>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const fn of [...listeners]) fn();
  }

  function applyOp(op: BoardOp): void {
    switch (op.type) {
      case 'add':
        for (const obj of op.objects) {
          if (!objects.has(obj.id)) objects.set(obj.id, cloneObject(obj));
        }
        break;
      case 'update':
        // 既存キーへの set は挿入順(重なり順)を保つ
        if (objects.has(op.object.id)) objects.set(op.object.id, cloneObject(op.object));
        break;
      case 'move':
        for (const id of op.ids) {
          const current = objects.get(id);
          if (current) objects.set(id, translated(current, op.dx, op.dy));
        }
        break;
      case 'remove':
        for (const id of op.ids) objects.delete(id);
        break;
      case 'clear':
        objects.clear();
        break;
    }
  }

  return {
    apply(op) {
      applyOp(op);
      notify();
    },
    reset(next) {
      objects.clear();
      for (const obj of next) {
        if (!objects.has(obj.id)) objects.set(obj.id, cloneObject(obj));
      }
      notify();
    },
    get(id) {
      return objects.get(id);
    },
    list() {
      return [...objects.values()];
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
