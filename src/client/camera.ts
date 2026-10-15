/** screen = (world - {x, y}) * zoom */
export type Camera = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function screenToWorld(c: Camera, sx: number, sy: number): { x: number; y: number } {
  return { x: sx / c.zoom + c.x, y: sy / c.zoom + c.y };
}

export function worldToScreen(c: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - c.x) * c.zoom, y: (wy - c.y) * c.zoom };
}

/** 画面上の点 (sx, sy) を固定したまま zoom を factor 倍する。zoom は範囲内に clamp する */
export function zoomAt(c: Camera, sx: number, sy: number, factor: number): Camera {
  const anchor = screenToWorld(c, sx, sy);
  const zoom = clampZoom(c.zoom * factor);
  return { x: anchor.x - sx / zoom, y: anchor.y - sy / zoom, zoom };
}

/** 表示内容が画面上で (dsx, dsy) ピクセル動くようにパンする */
export function panBy(c: Camera, dsx: number, dsy: number): Camera {
  return { x: c.x - dsx / c.zoom, y: c.y - dsy / c.zoom, zoom: c.zoom };
}
