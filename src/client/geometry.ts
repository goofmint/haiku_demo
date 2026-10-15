import type { BoardObject, StrokeObject, TextObject } from '../shared/types';
import { LINE_HEIGHT, MARKER_WIDTH_FACTOR } from './drawStyle';

export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/** 1行の幅を測る関数(ワールド単位) */
export type MeasureText = (line: string, fontSize: number) => number;

/**
 * 当たり判定・バウンディングボックスに使う線幅。
 * marker は描画幅(線幅 × MARKER_WIDTH_FACTOR)、それ以外は基準線幅(筆圧付きでも最大幅)。
 */
export function effectiveStrokeWidth(s: StrokeObject): number {
  return s.style === 'marker' ? s.width * MARKER_WIDTH_FACTOR : s.width;
}

export function distancePointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSq = vx * vx + vy * vy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / lengthSq));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/** 線幅の半分を含むバウンディングボックス */
export function strokeBounds(s: StrokeObject): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of s.points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const half = effectiveStrokeWidth(s) / 2;
  return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
}

/** 各行の幅の最大値 × (行数 × fontSize × 行高) の矩形。左上は (x, y) */
export function textBounds(t: TextObject, measure: MeasureText): Rect {
  const lines = t.text.split('\n');
  let width = 0;
  for (const line of lines) {
    const w = measure(line, t.fontSize);
    if (w > width) width = w;
  }
  const height = lines.length * t.fontSize * LINE_HEIGHT;
  return { minX: t.x, minY: t.y, maxX: t.x + width, maxY: t.y + height };
}

export function objectBounds(obj: BoardObject, measure: MeasureText): Rect {
  return obj.kind === 'stroke' ? strokeBounds(obj) : textBounds(obj, measure);
}

export function expandRect(r: Rect, amount: number): Rect {
  return {
    minX: r.minX - amount,
    minY: r.minY - amount,
    maxX: r.maxX + amount,
    maxY: r.maxY + amount,
  };
}

function pointInRect(r: Rect, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}

function hitStroke(s: StrokeObject, x: number, y: number, tolerance: number): boolean {
  const reach = effectiveStrokeWidth(s) / 2 + tolerance;
  if (!pointInRect(expandRect(strokeBounds(s), tolerance), x, y)) return false;
  const first = s.points[0];
  if (!first) return false;
  if (s.points.length === 1) return Math.hypot(x - first.x, y - first.y) <= reach;
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1];
    const b = s.points[i];
    if (a && b && distancePointToSegment(x, y, a.x, a.y, b.x, b.y) <= reach) return true;
  }
  return false;
}

function hitObject(
  obj: BoardObject,
  x: number,
  y: number,
  tolerance: number,
  measure: MeasureText,
): boolean {
  if (obj.kind === 'stroke') return hitStroke(obj, x, y, tolerance);
  return pointInRect(expandRect(textBounds(obj, measure), tolerance), x, y);
}

/** 重なり順の上(配列の末尾)から判定し、最初に当たったものを返す */
export function hitTest(
  objects: BoardObject[],
  x: number,
  y: number,
  tolerance: number,
  measure: MeasureText,
): BoardObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj && hitObject(obj, x, y, tolerance, measure)) return obj;
  }
  return null;
}

/** 辺が接するだけでも true */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** すべての矩形の和集合を padding だけ広げた矩形。空配列なら null */
export function exportBounds(rects: Rect[], padding: number): Rect | null {
  const first = rects[0];
  if (!first) return null;
  let { minX, minY, maxX, maxY } = first;
  for (const r of rects) {
    if (r.minX < minX) minX = r.minX;
    if (r.minY < minY) minY = r.minY;
    if (r.maxX > maxX) maxX = r.maxX;
    if (r.maxY > maxY) maxY = r.maxY;
  }
  return expandRect({ minX, minY, maxX, maxY }, padding);
}

/** 長辺 × preferredScale が maxSide を超える場合は maxSide / 長辺 に下げる */
export function exportScale(bounds: Rect, preferredScale: number, maxSide: number): number {
  const longest = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (longest * preferredScale > maxSide) return maxSide / longest;
  return preferredScale;
}
