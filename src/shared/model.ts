export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface Point {
  x: number;
  y: number;
  /** Pen pressure in the range 0..1. Mouse and touch use 0.5. */
  p: number;
}

export interface StrokeObject {
  kind: 'stroke';
  id: string;
  color: string;
  width: number;
  lineStyle: LineStyle;
  /** When true, the rendered width follows each point's pressure. */
  pressure: boolean;
  points: Point[];
}

export interface TextObject {
  kind: 'text';
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  /** Same scale as stroke width. Font size is derived from it (see `textFontSize`). */
  width: number;
  lineStyle: LineStyle;
}

export type WhiteboardObject = StrokeObject | TextObject;

/** Fields that can be changed with a `patch` op. */
export interface ObjectChanges {
  color?: string;
  width?: number;
  lineStyle?: LineStyle;
  text?: string;
}

export type Op =
  | { type: 'add'; object: WhiteboardObject }
  | { type: 'append'; id: string; points: Point[] }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'patch'; id: string; changes: ObjectChanges }
  | { type: 'remove'; ids: string[] }
  | { type: 'clear' };

export type ClientMessage = { type: 'join'; room: string } | { type: 'op'; op: Op };

export type ServerMessage =
  | { type: 'snapshot'; objects: WhiteboardObject[] }
  | { type: 'op'; op: Op };

export const LINE_STYLES: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];

export function textFontSize(width: number): number {
  return 12 + width * 2;
}
