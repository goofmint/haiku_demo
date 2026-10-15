import type { Point, StrokeObject, TextObject, WhiteboardObject } from '../shared/model.ts';
import { textFontSize } from '../shared/model.ts';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Measures the advance width of a single line of text at the given font size. */
export type MeasureText = (line: string, fontSize: number) => number;

/** Extra distance (CSS px) around a stroke that still counts as a hit. */
const HIT_TOLERANCE = 6;
const TEXT_LINE_HEIGHT = 1.3;

export function strokeHalfWidth(stroke: StrokeObject): number {
  return stroke.width / 2;
}

export function textLines(text: string): string[] {
  return text.split('\n');
}

export function textBounds(text: TextObject, measure: MeasureText): Bounds {
  const fontSize = textFontSize(text.width);
  const lines = textLines(text.text);
  const width = Math.max(0, ...lines.map((line) => measure(line, fontSize)));
  const height = lines.length * fontSize * TEXT_LINE_HEIGHT;
  return { minX: text.x, minY: text.y, maxX: text.x + width, maxY: text.y + height };
}

export function objectBounds(object: WhiteboardObject, measure: MeasureText): Bounds {
  if (object.kind === 'text') return textBounds(object, measure);
  const half = strokeHalfWidth(object);
  const xs = object.points.map((point) => point.x);
  const ys = object.points.map((point) => point.y);
  return {
    minX: Math.min(...xs) - half,
    minY: Math.min(...ys) - half,
    maxX: Math.max(...xs) + half,
    maxY: Math.max(...ys) + half,
  };
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  return list.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }));
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function distanceToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSq));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function strokeHit(stroke: StrokeObject, x: number, y: number): boolean {
  const reach = strokeHalfWidth(stroke) + HIT_TOLERANCE;
  const { points } = stroke;
  if (points.length === 1) {
    const only = points[0];
    return only !== undefined && Math.hypot(x - only.x, y - only.y) <= reach;
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b && distanceToSegment(x, y, a, b) <= reach) return true;
  }
  return false;
}

export function hitTest(object: WhiteboardObject, x: number, y: number, measure: MeasureText): boolean {
  if (object.kind === 'stroke') return strokeHit(object, x, y);
  const bounds = textBounds(object, measure);
  return x >= bounds.minX - HIT_TOLERANCE && x <= bounds.maxX + HIT_TOLERANCE
    && y >= bounds.minY - HIT_TOLERANCE && y <= bounds.maxY + HIT_TOLERANCE;
}

export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Bounds {
  return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
}
