export const LIMITS = {
  /** WebSocket 1メッセージの最大バイト数(ws の maxPayload) */
  maxPayloadBytes: 1_048_576,
  /** 1ストロークの最大点数 */
  maxPointsPerStroke: 5000,
  /** テキストの最大文字数 */
  maxTextLength: 5000,
  /** 1ルームの最大オブジェクト数 */
  maxObjectsPerRoom: 10_000,
  /** ルーム ID の形式 */
  roomIdPattern: /^[A-Za-z0-9_-]{1,64}$/,
  /** 最後の1人が抜けてからルームを破棄するまでの時間(ms) */
  emptyRoomTtlMs: 3_600_000,
  /** オブジェクト ID などの識別子の最大長 */
  maxIdLength: 64,
  /** 線幅の最大値(0 より大きいこと) */
  maxStrokeWidth: 200,
  /** 文字サイズの最小値 */
  minFontSize: 4,
  /** 文字サイズの最大値 */
  maxFontSize: 400,
  /** 筆圧の最小値 */
  minPressure: 0,
  /** 筆圧の最大値 */
  maxPressure: 1,
  /** ワールド座標の絶対値の上限(移動の繰り返しで Infinity になるのを防ぐ) */
  maxCoordinate: 10_000_000,
} as const;
