import type { BoardObject } from '../shared/types';
import type { BoardOp } from './board';

export type Command =
  | { type: 'add'; objects: BoardObject[] }
  | { type: 'remove'; objects: BoardObject[] }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'update'; before: BoardObject; after: BoardObject };

export type History = {
  /** 履歴に積む。redo スタックを空にする */
  push(cmd: Command): void;
  /** 逆操作を返す。適用できる履歴が無ければ null */
  undo(exists: (id: string) => boolean): BoardOp | null;
  /** 再適用する操作を返す。適用できる履歴が無ければ null */
  redo(exists: (id: string) => boolean): BoardOp | null;
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
};

type Exists = (id: string) => boolean;

/** まだ存在しないオブジェクトだけを追加する操作。対象が無ければ null */
function addOp(objects: BoardObject[], exists: Exists): BoardOp | null {
  const targets = objects.filter((o) => !exists(o.id));
  return targets.length > 0 ? { type: 'add', objects: targets } : null;
}

/** 存在するオブジェクトだけを削除する操作。対象が無ければ null */
function removeOp(ids: string[], exists: Exists): BoardOp | null {
  const targets = ids.filter((id) => exists(id));
  return targets.length > 0 ? { type: 'remove', ids: targets } : null;
}

function moveOp(ids: string[], dx: number, dy: number, exists: Exists): BoardOp | null {
  const targets = ids.filter((id) => exists(id));
  return targets.length > 0 ? { type: 'move', ids: targets, dx, dy } : null;
}

function updateOp(object: BoardObject, exists: Exists): BoardOp | null {
  return exists(object.id) ? { type: 'update', object } : null;
}

function inverseOf(cmd: Command, exists: Exists): BoardOp | null {
  switch (cmd.type) {
    case 'add':
      return removeOp(
        cmd.objects.map((o) => o.id),
        exists,
      );
    case 'remove':
      return addOp(cmd.objects, exists);
    case 'move':
      return moveOp(cmd.ids, -cmd.dx, -cmd.dy, exists);
    case 'update':
      return updateOp(cmd.before, exists);
  }
}

function forwardOf(cmd: Command, exists: Exists): BoardOp | null {
  switch (cmd.type) {
    case 'add':
      return addOp(cmd.objects, exists);
    case 'remove':
      return removeOp(
        cmd.objects.map((o) => o.id),
        exists,
      );
    case 'move':
      return moveOp(cmd.ids, cmd.dx, cmd.dy, exists);
    case 'update':
      return updateOp(cmd.after, exists);
  }
}

export function createHistory(): History {
  const undoStack: Command[] = [];
  const redoStack: Command[] = [];

  /**
   * from の末尾から順に操作を作る。対象がすべて消えている履歴は破棄して次へ進む。
   * 使った履歴は元のコマンドのまま to へ移す。
   */
  function step(
    from: Command[],
    to: Command[],
    build: (cmd: Command, exists: Exists) => BoardOp | null,
    exists: Exists,
  ): BoardOp | null {
    for (let cmd = from.pop(); cmd !== undefined; cmd = from.pop()) {
      const op = build(cmd, exists);
      if (op) {
        to.push(cmd);
        return op;
      }
    }
    return null;
  }

  return {
    push(cmd) {
      undoStack.push(cmd);
      redoStack.length = 0;
    },
    undo(exists) {
      return step(undoStack, redoStack, inverseOf, exists);
    },
    redo(exists) {
      return step(redoStack, undoStack, forwardOf, exists);
    },
    clear() {
      undoStack.length = 0;
      redoStack.length = 0;
    },
    canUndo() {
      return undoStack.length > 0;
    },
    canRedo() {
      return redoStack.length > 0;
    },
  };
}
