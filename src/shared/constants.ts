import type { LineStyle } from './types.js';

export const COLOR_PRESETS: string[] = ['#000000', '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa'];
export const WIDTH_PRESETS: number[] = [2, 4, 8, 14];

export const DEFAULT_COLOR = '#000000';
export const DEFAULT_WIDTH = 4;
export const DEFAULT_LINE_STYLE: LineStyle = 'solid';
export const DEFAULT_FONT_SIZE = 24;

export const TEXT_FONT_FAMILY = "'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif";

export const ERASER_RADIUS = 12;
export const HIT_TOLERANCE = 8;

export const DEFAULT_PRESSURE = 0.5;

export const DASH_PATTERNS: Record<LineStyle, number[]> = {
  solid: [],
  dashed: [12, 8],
  dotted: [2, 6],
};
