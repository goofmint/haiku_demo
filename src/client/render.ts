import type { BoardObject, Point, StrokeObject, TextObject } from '../shared/types';
import type { Camera } from './camera';
import {
  DASH_OFF_FACTOR,
  DASH_ON_FACTOR,
  DOT_GAP_FACTOR,
  DOT_ON_LENGTH,
  LINE_HEIGHT,
  MARKER_ALPHA,
  MARKER_WIDTH_FACTOR,
  MARQUEE_COLOR,
  MARQUEE_FILL_ALPHA,
  MARQUEE_LINE_WIDTH_PX,
  PRESSURE_MIN_FACTOR,
  PRESSURE_RANGE_FACTOR,
  PRESSURE_VARIATION_EPSILON,
  SELECTION_COLOR,
  SELECTION_DASH_PX,
  SELECTION_LINE_WIDTH_PX,
  SELECTION_PADDING_PX,
  fontString,
} from './drawStyle';
import type { MeasureText, Rect } from './geometry';
import { expandRect, objectBounds, rectsIntersect } from './geometry';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type RenderParams = {
  objects: BoardObject[];
  /** 描画中の線(自分・他人)。確定済みオブジェクトの上に描く */
  drafts: StrokeObject[];
  camera: Camera;
  selectedIds: ReadonlySet<string>;
  /** キャンバスの CSS ピクセルサイズ */
  cssWidth: number;
  cssHeight: number;
  /** window.devicePixelRatio */
  dpr: number;
  measure: MeasureText;
  /** 範囲選択中の矩形(ワールド座標) */
  marquee?: Rect | null;
};

/** 描画と同じフォント指定で 1 行の幅を測る関数を作る(オフスクリーンのコンテキストを使い回す) */
export function createTextMeasurer(): MeasureText {
  let ctx: CanvasRenderingContext2D | null = null;
  return (line, fontSize) => {
    if (!ctx) {
      ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context is not available');
    }
    const font = fontString(fontSize);
    if (ctx.font !== font) ctx.font = font;
    return ctx.measureText(line).width;
  };
}

function pressureWidth(width: number, p: number): number {
  return width * (PRESSURE_MIN_FACTOR + PRESSURE_RANGE_FACTOR * p);
}

function midpoint(a: Point, b: Point): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** 隣接点の中点を結ぶ二次ベジェ曲線で 1 本のパスを作る(points は 2 点以上) */
function traceSmoothPath(ctx: Ctx2D, points: Point[]): void {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i];
    const next = points[i + 1];
    if (!control || !next) continue;
    const end = midpoint(control, next);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  }
  ctx.lineTo(last.x, last.y);
}

/** 区間ごとに筆圧で線幅を変えて描く(points は 2 点以上) */
function strokePressureSegments(ctx: Ctx2D, points: Point[], width: number): void {
  const first = points[0];
  if (!first) return;
  let start: { x: number; y: number } = { x: first.x, y: first.y };
  for (let i = 1; i < points.length - 1; i++) {
    const control = points[i];
    const next = points[i + 1];
    if (!control || !next) continue;
    const end = midpoint(control, next);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    ctx.lineWidth = pressureWidth(width, control.p);
    ctx.stroke();
    start = end;
  }
  const prev = points[points.length - 2];
  const last = points[points.length - 1];
  if (!prev || !last) return;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(last.x, last.y);
  ctx.lineWidth = pressureWidth(width, (prev.p + last.p) / 2);
  ctx.stroke();
}

function hasPressureVariation(points: Point[]): boolean {
  let min = Infinity;
  let max = -Infinity;
  for (const pt of points) {
    if (pt.p < min) min = pt.p;
    if (pt.p > max) max = pt.p;
  }
  return max - min > PRESSURE_VARIATION_EPSILON;
}

function drawStroke(ctx: Ctx2D, s: StrokeObject): void {
  const first = s.points[0];
  if (!first) return;
  const usePressure = s.style === 'solid' && s.pressure;
  const isMarker = s.style === 'marker';

  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = s.style === 'dashed' ? 'butt' : 'round';
  if (isMarker) ctx.globalAlpha = MARKER_ALPHA;

  if (s.points.length === 1) {
    let diameter = isMarker ? s.width * MARKER_WIDTH_FACTOR : s.width;
    if (usePressure) diameter = pressureWidth(s.width, first.p);
    ctx.beginPath();
    ctx.arc(first.x, first.y, diameter / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (usePressure && hasPressureVariation(s.points)) {
    strokePressureSegments(ctx, s.points, s.width);
    return;
  }

  switch (s.style) {
    case 'solid':
      // 筆圧 ON で変化が無い場合も、筆圧付きの幅に揃える
      ctx.lineWidth = usePressure ? pressureWidth(s.width, first.p) : s.width;
      break;
    case 'dashed':
      ctx.lineWidth = s.width;
      ctx.setLineDash([s.width * DASH_ON_FACTOR, s.width * DASH_OFF_FACTOR]);
      break;
    case 'dotted':
      ctx.lineWidth = s.width;
      ctx.setLineDash([DOT_ON_LENGTH, s.width * DOT_GAP_FACTOR]);
      break;
    case 'marker':
      ctx.lineWidth = s.width * MARKER_WIDTH_FACTOR;
      break;
  }
  traceSmoothPath(ctx, s.points);
  ctx.stroke();
}

function drawText(ctx: Ctx2D, t: TextObject): void {
  ctx.font = fontString(t.fontSize);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'top';
  const lineStep = t.fontSize * LINE_HEIGHT;
  t.text.split('\n').forEach((line, i) => {
    ctx.fillText(line, t.x, t.y + i * lineStep);
  });
}

/** 1 オブジェクトをワールド座標で描く(変換行列は呼び出し側で設定済みであること) */
export function drawObject(ctx: Ctx2D, obj: BoardObject, measure: MeasureText): void {
  // measure はテキスト描画では使わないが、呼び出し側の API を揃えるため受け取る
  void measure;
  ctx.save();
  try {
    if (obj.kind === 'stroke') drawStroke(ctx, obj);
    else drawText(ctx, obj);
  } finally {
    ctx.restore();
  }
}

function drawSelectionBox(ctx: Ctx2D, rect: Rect, zoom: number): void {
  const r = expandRect(rect, SELECTION_PADDING_PX / zoom);
  ctx.save();
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = SELECTION_LINE_WIDTH_PX / zoom;
  ctx.setLineDash([SELECTION_DASH_PX / zoom, SELECTION_DASH_PX / zoom]);
  ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
  ctx.restore();
}

function drawMarquee(ctx: Ctx2D, rect: Rect, zoom: number): void {
  const w = rect.maxX - rect.minX;
  const h = rect.maxY - rect.minY;
  ctx.save();
  ctx.fillStyle = MARQUEE_COLOR;
  ctx.globalAlpha = MARQUEE_FILL_ALPHA;
  ctx.fillRect(rect.minX, rect.minY, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = MARQUEE_COLOR;
  ctx.lineWidth = MARQUEE_LINE_WIDTH_PX / zoom;
  ctx.strokeRect(rect.minX, rect.minY, w, h);
  ctx.restore();
}

/** 表示中のワールド矩形 */
export function visibleWorldRect(camera: Camera, cssWidth: number, cssHeight: number): Rect {
  return {
    minX: camera.x,
    minY: camera.y,
    maxX: camera.x + cssWidth / camera.zoom,
    maxY: camera.y + cssHeight / camera.zoom,
  };
}

/** 画面全体を描き直す。画面外のオブジェクトは描画を省略する */
export function renderScene(ctx: Ctx2D, params: RenderParams): void {
  const { camera, cssWidth, cssHeight, dpr, measure } = params;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const scale = dpr * camera.zoom;
  ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);

  const view = visibleWorldRect(camera, cssWidth, cssHeight);
  const selectedBounds: Rect[] = [];
  for (const obj of params.objects) {
    const bounds = objectBounds(obj, measure);
    if (params.selectedIds.has(obj.id)) selectedBounds.push(bounds);
    if (rectsIntersect(bounds, view)) drawObject(ctx, obj, measure);
  }
  for (const draft of params.drafts) {
    if (rectsIntersect(objectBounds(draft, measure), view)) drawObject(ctx, draft, measure);
  }
  for (const bounds of selectedBounds) {
    if (rectsIntersect(bounds, view)) drawSelectionBox(ctx, bounds, camera.zoom);
  }
  if (params.marquee) drawMarquee(ctx, params.marquee, camera.zoom);
}
