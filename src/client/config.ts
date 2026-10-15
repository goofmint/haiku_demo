import type { StrokeStyle } from '../shared/types';

/** ツール名 */
export type ToolName = 'select' | 'pen' | 'eraser' | 'text' | 'pan';

/** ツールバーに並べる順序 */
export const TOOL_ORDER: readonly ToolName[] = ['select', 'pen', 'eraser', 'text', 'pan'];

/** 起動時のツール */
export const DEFAULT_TOOL: ToolName = 'pen';

/** プリセットカラー(8色、'#rrggbb') */
export const PRESET_COLORS: readonly string[] = [
  '#000000',
  '#6b7280',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
];

/** 起動時の色 */
export const DEFAULT_COLOR = '#000000';

/** 線幅スライダー(ワールド単位) */
export const STROKE_WIDTH_MIN = 1;
export const STROKE_WIDTH_MAX = 40;
export const STROKE_WIDTH_STEP = 1;
export const STROKE_WIDTH_DEFAULT = 4;

/** 線種の並び順 */
export const STROKE_STYLE_ORDER: readonly StrokeStyle[] = ['solid', 'dashed', 'dotted', 'marker'];

/** 起動時の線種 */
export const DEFAULT_STROKE_STYLE: StrokeStyle = 'solid';

/** 起動時の筆圧設定 */
export const DEFAULT_PRESSURE_ENABLED = true;

/** 文字サイズの選択肢(ワールド単位) */
export const FONT_SIZE_OPTIONS: readonly number[] = [12, 16, 20, 24, 32, 48, 64, 96];

/** 起動時の文字サイズ */
export const DEFAULT_FONT_SIZE = 24;

/** 筆圧を取れない入力(マウス・指)で記録する筆圧値 */
export const CONSTANT_POINTER_PRESSURE = 0.5;

/** ペンを離してからタッチを無視し続ける時間(簡易パームリジェクション) */
export const PALM_REJECTION_MS = 500;

/** ダブルタップ判定: 2回のタップの最大間隔と最大距離(画面ピクセル) */
export const DOUBLE_TAP_MS = 350;
export const DOUBLE_TAP_PX = 24;

/** タップとドラッグを区別する移動量(画面ピクセル) */
export const TAP_MOVE_TOLERANCE_PX = 6;

/** 当たり判定の許容値(画面ピクセル) */
export const HIT_TOLERANCE_PX = 6;

/** 消しゴムの最小半径(画面ピクセル) */
export const ERASER_RADIUS_PX = 8;

/** Ctrl/⌘ + ホイールのズーム感度: factor = exp(-deltaY × WHEEL_ZOOM_SENSITIVITY) */
export const WHEEL_ZOOM_SENSITIVITY = 0.01;

/** WheelEvent.deltaMode が行単位のときの 1 行あたりのピクセル数 */
export const WHEEL_LINE_HEIGHT_PX = 16;

/** iOS が自動ズームしない textarea の最小 font-size(CSS ピクセル) */
export const IOS_MIN_INPUT_FONT_PX = 16;

/** 空のテキスト編集欄の最小幅(font-size に対する倍率) */
export const TEXT_EDITOR_MIN_WIDTH_EM = 1;

/** 末尾のキャレット分の余白(font-size に対する倍率) */
export const TEXT_EDITOR_CARET_ROOM_EM = 0.5;

/** 再接続の指数バックオフ */
export const RECONNECT_INITIAL_DELAY_MS = 500;
export const RECONNECT_BACKOFF_FACTOR = 2;
export const RECONNECT_MAX_DELAY_MS = 5000;

/** WebSocket のパス */
export const WS_PATH = '/ws';

/** ルーム ID の URL パラメータ名 */
export const ROOM_QUERY_PARAM = 'room';

/** 自動生成するルーム ID の長さ(createId() の先頭) */
export const GENERATED_ROOM_ID_LENGTH = 8;

/** トーストの表示時間 */
export const TOAST_DURATION_MS = 2500;
