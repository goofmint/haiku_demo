import { DEFAULT_COLOR, DEFAULT_FONT_SIZE, DEFAULT_LINE_STYLE, DEFAULT_WIDTH } from '../shared/constants.js';
import type { BoardObject, LineStyle, ToolKind } from '../shared/types.js';

export type BoardState = {
  getObjects(): readonly BoardObject[];
  getSelectedIds(): ReadonlySet<string>;
  getTool(): ToolKind; setTool(t: ToolKind): void;
  getColor(): string; setColor(c: string): void;
  getWidth(): number; setWidth(w: number): void;
  getLineStyle(): LineStyle; setLineStyle(s: LineStyle): void;
  getFontSize(): number;
  addObject(obj: BoardObject, mine: boolean): void;   // mine=true pushes id onto undo stack
  moveObjects(ids: string[], dx: number, dy: number): void;
  deleteObjects(ids: string[]): void;
  clear(): void;
  replaceAll(objects: BoardObject[]): void;            // from server 'init'
  setSelection(ids: Iterable<string>): void;
  popMyLastObjectId(): string | null;                  // for undo: pops ids until one that still exists, returns it or null
  findById(id: string): BoardObject | undefined;
  subscribe(listener: () => void): () => void;         // returns unsubscribe
};

export function createBoardState(): BoardState {
  let objects: BoardObject[] = [];
  const selectedIds = new Set<string>();
  const myObjectIds: string[] = [];
  const listeners = new Set<() => void>();

  let tool: ToolKind = 'pen';
  let color: string = DEFAULT_COLOR;
  let width: number = DEFAULT_WIDTH;
  let lineStyle: LineStyle = DEFAULT_LINE_STYLE;
  const fontSize: number = DEFAULT_FONT_SIZE;

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function findById(id: string): BoardObject | undefined {
    return objects.find((o) => o.id === id);
  }

  return {
    getObjects: () => objects,
    getSelectedIds: () => selectedIds,

    getTool: () => tool,
    setTool(t) {
      tool = t;
      notify();
    },
    getColor: () => color,
    setColor(c) {
      color = c;
      notify();
    },
    getWidth: () => width,
    setWidth(w) {
      width = w;
      notify();
    },
    getLineStyle: () => lineStyle,
    setLineStyle(s) {
      lineStyle = s;
      notify();
    },
    getFontSize: () => fontSize,

    addObject(obj, mine) {
      if (findById(obj.id) !== undefined) return;
      objects = [...objects, obj];
      if (mine) myObjectIds.push(obj.id);
      notify();
    },

    moveObjects(ids, dx, dy) {
      const target = new Set(ids);
      objects = objects.map((o) => {
        if (!target.has(o.id)) return o;
        if (o.kind === 'stroke') {
          return { ...o, points: o.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
        }
        return { ...o, x: o.x + dx, y: o.y + dy };
      });
      notify();
    },

    deleteObjects(ids) {
      const target = new Set(ids);
      objects = objects.filter((o) => !target.has(o.id));
      ids.forEach((id) => selectedIds.delete(id));
      notify();
    },

    clear() {
      objects = [];
      selectedIds.clear();
      myObjectIds.length = 0;
      notify();
    },

    replaceAll(next) {
      objects = [...next];
      const present = new Set(objects.map((o) => o.id));
      Array.from(selectedIds).forEach((id) => {
        if (!present.has(id)) selectedIds.delete(id);
      });
      notify();
    },

    setSelection(ids) {
      const next = Array.from(ids);
      selectedIds.clear();
      next.forEach((id) => selectedIds.add(id));
      notify();
    },

    popMyLastObjectId() {
      let id = myObjectIds.pop();
      while (id !== undefined) {
        if (findById(id) !== undefined) return id;
        id = myObjectIds.pop();
      }
      return null;
    },

    findById,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
