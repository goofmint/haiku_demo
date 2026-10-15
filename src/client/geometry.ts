import type { BoardObject, StrokeObject, TextObject } from '../shared/types.js';

export type Rect = { x: number; y: number; w: number; h: number };
export type Vec = { x: number; y: number };

export function distPointToSegment(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function strokeHit(stroke: StrokeObject, pt: Vec, tolerance: number): boolean {
  const reach = tolerance + stroke.width / 2;
  const pts = stroke.points;
  if (pts.length === 1) return Math.hypot(pt.x - pts[0].x, pt.y - pts[0].y) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (distPointToSegment(pt, pts[i - 1], pts[i]) <= reach) return true;
  }
  return false;
}

export function boundsOf(
  obj: BoardObject,
  measureText: (t: TextObject) => { w: number; h: number },
): Rect {
  if (obj.kind === 'text') {
    const m = measureText(obj);
    return { x: obj.x, y: obj.y, w: m.w, h: m.h };
  }
  const half = obj.width / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of obj.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return {
    x: minX - half,
    y: minY - half,
    w: maxX - minX + obj.width,
    h: maxY - minY + obj.width,
  };
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function pointInRect(pt: Vec, r: Rect): boolean {
  return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
}

export function normalizeRect(a: Vec, b: Vec): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function hitTest(
  obj: BoardObject,
  pt: Vec,
  tolerance: number,
  measureText: (t: TextObject) => { w: number; h: number },
): boolean {
  if (obj.kind === 'stroke') return strokeHit(obj, pt, tolerance);
  return pointInRect(pt, boundsOf(obj, measureText));
}
