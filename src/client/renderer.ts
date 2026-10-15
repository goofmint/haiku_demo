import { DASH_PATTERNS, TEXT_FONT_FAMILY } from '../shared/constants.js';
import type { BoardObject, StrokeObject, TextObject } from '../shared/types.js';
import { boundsOf } from './geometry.js';
import type { Rect } from './geometry.js';

export const TEXT_LINE_HEIGHT_RATIO = 1.3;

const BACKGROUND_COLOR = '#ffffff';
const SELECTION_COLOR = '#1e88e5';
const SELECTION_PADDING_PX = 4;
const SELECTION_DASH: number[] = [4, 3];
const RUBBER_BAND_FILL = 'rgba(30, 136, 229, 0.1)';

export type Renderer = {
  resize(): void;                                   // set canvas size = board element CSS size * devicePixelRatio, ctx.scale(dpr,dpr), re-render last frame
  render(objects: readonly BoardObject[], selectedIds: ReadonlySet<string>, inProgress: StrokeObject | null, selectionRect: Rect | null): void;
  measureText(t: TextObject): { w: number; h: number };
  getCanvas(): HTMLCanvasElement;
};

type Frame = {
  objects: readonly BoardObject[];
  selectedIds: ReadonlySet<string>;
  inProgress: StrokeObject | null;
  selectionRect: Rect | null;
};

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const maybeCtx = canvas.getContext('2d');
  if (maybeCtx === null) throw new Error('Canvas 2D context is not available');
  const ctx: CanvasRenderingContext2D = maybeCtx;

  let dpr = 1;
  let lastFrame: Frame = {
    objects: [],
    selectedIds: new Set<string>(),
    inProgress: null,
    selectionRect: null,
  };

  function measureText(t: TextObject): { w: number; h: number } {
    ctx.font = `${t.fontSize}px ${TEXT_FONT_FAMILY}`;
    const lines = t.text.split('\n');
    let maxWidth = 0;
    for (const line of lines) {
      maxWidth = Math.max(maxWidth, ctx.measureText(line).width);
    }
    return { w: maxWidth, h: lines.length * t.fontSize * TEXT_LINE_HEIGHT_RATIO };
  }

  function drawStroke(s: StrokeObject): void {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(DASH_PATTERNS[s.lineStyle].map((v) => (v * s.width) / 4));

    const pts = s.points;
    if (pts.length === 1) {
      const only = pts[0];
      ctx.beginPath();
      ctx.arc(only.x, only.y, (s.width * (0.5 + only.p)) / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // lineDashOffset carries the travelled length so dashes stay continuous across segments.
    let travelled = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      ctx.lineWidth = s.width * (0.5 + b.p);
      ctx.lineDashOffset = -travelled;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      travelled += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }

  function drawText(t: TextObject): void {
    ctx.font = `${t.fontSize}px ${TEXT_FONT_FAMILY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = t.color;
    t.text.split('\n').forEach((line, i) => {
      ctx.fillText(line, t.x, t.y + i * t.fontSize * TEXT_LINE_HEIGHT_RATIO);
    });
  }

  function drawSelection(obj: BoardObject): void {
    const b = boundsOf(obj, measureText);
    ctx.save();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash(SELECTION_DASH);
    ctx.lineDashOffset = 0;
    ctx.strokeRect(
      b.x - SELECTION_PADDING_PX,
      b.y - SELECTION_PADDING_PX,
      b.w + SELECTION_PADDING_PX * 2,
      b.h + SELECTION_PADDING_PX * 2,
    );
    ctx.restore();
  }

  function drawRubberBand(r: Rect): void {
    ctx.save();
    ctx.fillStyle = RUBBER_BAND_FILL;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash(SELECTION_DASH);
    ctx.lineDashOffset = 0;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  function paint(frame: Frame): void {
    // Clear with an identity transform so the whole backing store is white (PNG export gets a white background too).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    for (const obj of frame.objects) {
      if (obj.kind === 'stroke') drawStroke(obj);
      else drawText(obj);
    }
    if (frame.inProgress !== null) drawStroke(frame.inProgress);

    for (const obj of frame.objects) {
      if (frame.selectedIds.has(obj.id)) drawSelection(obj);
    }
    if (frame.selectionRect !== null) drawRubberBand(frame.selectionRect);
  }

  return {
    resize() {
      dpr = window.devicePixelRatio;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      paint(lastFrame);
    },
    render(objects, selectedIds, inProgress, selectionRect) {
      lastFrame = { objects, selectedIds, inProgress, selectionRect };
      paint(lastFrame);
    },
    measureText,
    getCanvas: () => canvas,
  };
}
