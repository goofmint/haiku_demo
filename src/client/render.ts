import type { LineStyle, Point, StrokeObject, WhiteboardObject } from '../shared/model.ts';
import { textFontSize } from '../shared/model.ts';
import { objectBounds, textLines, type Bounds, type MeasureText } from './geometry.ts';

export const FONT_FAMILY = '"Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Meiryo", sans-serif';
const TEXT_LINE_HEIGHT = 1.3;
const SELECTION_COLOR = '#2563eb';

const measureCanvas = document.createElement('canvas');
const measureContext = measureCanvas.getContext('2d');
if (!measureContext) throw new Error('2D canvas is not supported in this browser');

export const measureText: MeasureText = (line, fontSize) => {
  measureContext.font = `${fontSize}px ${FONT_FAMILY}`;
  return measureContext.measureText(line).width;
};

function dashPattern(lineStyle: LineStyle, width: number): number[] {
  switch (lineStyle) {
    case 'solid':
      return [];
    case 'dashed':
      return [width * 3, width * 2];
    case 'dotted':
      // A near-zero dash with round caps renders as dots.
      return [0.01, width * 2.2];
  }
}

function pointWidth(stroke: StrokeObject, point: Point): number {
  if (!stroke.pressure) return stroke.width;
  const pressure = Math.min(1, Math.max(0, point.p));
  return stroke.width * (0.25 + 0.75 * pressure);
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeObject): void {
  const { points } = stroke;
  const first = points[0];
  if (!first) return;

  ctx.strokeStyle = stroke.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (points.length === 1) {
    // A single point (tap) is drawn as a dot.
    ctx.fillStyle = stroke.color;
    ctx.beginPath();
    ctx.arc(first.x, first.y, pointWidth(stroke, first) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (!stroke.pressure) {
    ctx.lineWidth = stroke.width;
    ctx.setLineDash(dashPattern(stroke.lineStyle, stroke.width));
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  // Pressure-sensitive strokes are drawn segment by segment so the width can change.
  // lineDashOffset carries the distance travelled so dash patterns stay continuous.
  const dash = dashPattern(stroke.lineStyle, stroke.width);
  let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    ctx.lineWidth = (pointWidth(stroke, a) + pointWidth(stroke, b)) / 2;
    ctx.setLineDash(dash);
    ctx.lineDashOffset = -distance;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    distance += Math.hypot(b.x - a.x, b.y - a.y);
  }
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

export function drawText(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string, width: number): void {
  const fontSize = textFontSize(width);
  ctx.font = `${fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  textLines(text).forEach((line, index) => {
    ctx.fillText(line, x, y + index * fontSize * TEXT_LINE_HEIGHT);
  });
}

export function drawObject(ctx: CanvasRenderingContext2D, object: WhiteboardObject): void {
  if (object.kind === 'stroke') {
    drawStroke(ctx, object);
  } else {
    drawText(ctx, object.x, object.y, object.text, object.color, object.width);
  }
}

export function drawObjects(ctx: CanvasRenderingContext2D, objects: Iterable<WhiteboardObject>): void {
  for (const object of objects) drawObject(ctx, object);
}

export function drawSelection(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
  ctx.save();
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(bounds.minX - 4, bounds.minY - 4, bounds.maxX - bounds.minX + 8, bounds.maxY - bounds.minY + 8);
  ctx.restore();
}

export function drawRubberBand(ctx: CanvasRenderingContext2D, rect: Bounds): void {
  ctx.save();
  ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.fillRect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
  ctx.strokeRect(rect.minX, rect.minY, rect.maxX - rect.minX, rect.maxY - rect.minY);
  ctx.restore();
}

/** Bounds for a set of objects, used by PNG export and selection outlines. */
export function boundsOf(object: WhiteboardObject): Bounds {
  return objectBounds(object, measureText);
}
