/**
 * 描画・当たり判定・PNG 書き出しで共有するスタイル定数(設計書 6.7 / 6.8 / 6.10)。
 */

/** テキストの行高(fontSize に対する倍率) */
export const LINE_HEIGHT = 1.3;

/** テキストのフォントファミリー */
export const FONT_FAMILY = 'system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif';

/** fontSize からキャンバス用の font 文字列を作る */
export function fontString(fontSize: number): string {
  return `${fontSize}px ${FONT_FAMILY}`;
}

/** マーカーの描画幅(基準線幅に対する倍率) */
export const MARKER_WIDTH_FACTOR = 3;

/** マーカーの不透明度 */
export const MARKER_ALPHA = 0.35;

/** 筆圧による線幅: width × (PRESSURE_MIN_FACTOR + PRESSURE_RANGE_FACTOR × p) */
export const PRESSURE_MIN_FACTOR = 0.2;
export const PRESSURE_RANGE_FACTOR = 0.8;

/** 筆圧の値が「変化している」とみなす最小差 */
export const PRESSURE_VARIATION_EPSILON = 1e-3;

/** 破線: setLineDash([width × DASH_ON_FACTOR, width × DASH_OFF_FACTOR]) */
export const DASH_ON_FACTOR = 3;
export const DASH_OFF_FACTOR = 2;

/** 点線: setLineDash([DOT_ON_LENGTH, width × DOT_GAP_FACTOR]) + lineCap round */
export const DOT_ON_LENGTH = 0.1;
export const DOT_GAP_FACTOR = 2;

/** 選択枠(画面ピクセル単位) */
export const SELECTION_COLOR = '#2563eb';
export const SELECTION_LINE_WIDTH_PX = 1.5;
export const SELECTION_DASH_PX = 4;
export const SELECTION_PADDING_PX = 4;

/** 範囲選択の矩形(画面ピクセル単位の線幅と塗りの不透明度) */
export const MARQUEE_COLOR = '#2563eb';
export const MARQUEE_LINE_WIDTH_PX = 1;
export const MARQUEE_FILL_ALPHA = 0.08;

/** PNG 書き出し */
export const EXPORT_PADDING = 32;
export const EXPORT_PREFERRED_SCALE = 2;
export const EXPORT_MAX_SIDE = 8192;
export const EXPORT_BACKGROUND = '#ffffff';
