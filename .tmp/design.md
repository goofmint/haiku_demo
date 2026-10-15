# 設計: ホワイトボードアプリ

## 技術スタック
- クライアント: Vite + TypeScript（Vanilla、フレームワーク無し）、Canvas 2D、Pointer Events
- サーバー: Node.js + `ws`（WebSocket）、`http` 標準モジュールで静的配信
- 開発: `tsx` でサーバー起動、`concurrently` で dev 同時起動、`vite` の proxy で `/ws` をサーバーへ転送

## ディレクトリ構成
```
package.json
tsconfig.json              # クライアント用（vite）
tsconfig.server.json       # サーバー用
vite.config.ts
index.html
src/
  shared/
    types.ts               # オブジェクト型・WSメッセージ型（クライアント/サーバー共通）
    constants.ts           # 色・線幅プリセット、フォント、デフォルト値
  client/
    main.ts                # エントリ。各モジュールを結線
    state.ts               # ボード状態（オブジェクト配列、選択、ツール設定）とイベント通知
    renderer.ts            # Canvas描画（全オブジェクト再描画、選択枠、DPR対応、リサイズ）
    tools.ts               # Pointer Events処理：pen / eraser / select / text の各ツール
    geometry.ts            # 当たり判定（点と線分の距離、矩形判定、バウンディングボックス）
    text-input.ts          # IME対応テキスト入力オーバーレイ
    sync.ts                # WebSocket クライアント（送受信、再接続）
    export.ts              # PNGダウンロード
    toolbar.ts             # ツールバーDOM構築とイベント
    style.css
  server/
    index.ts               # http + ws サーバー、ルーム管理
```

## 共通型（src/shared/types.ts）— 全モジュールはこの定義に従う
```ts
export type Point = { x: number; y: number; p: number }; // p = 筆圧 0..1（非対応時 0.5）
export type LineStyle = 'solid' | 'dashed' | 'dotted';

export type StrokeObject = {
  id: string;
  kind: 'stroke';
  points: Point[];
  color: string;      // '#rrggbb'
  width: number;      // 基本線幅(px)。筆圧で 0.5x〜1.5x に変化
  lineStyle: LineStyle;
};

export type TextObject = {
  id: string;
  kind: 'text';
  x: number; y: number;   // 左上
  text: string;
  color: string;
  fontSize: number;
};

export type BoardObject = StrokeObject | TextObject;

export type ToolKind = 'pen' | 'eraser' | 'select' | 'text';

// --- WebSocket メッセージ ---
// クライアント → サーバー
export type ClientMessage =
  | { type: 'join'; room: string }
  | { type: 'add'; object: BoardObject }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'delete'; ids: string[] }
  | { type: 'clear' };

// サーバー → クライアント
export type ServerMessage =
  | { type: 'init'; objects: BoardObject[]; clientId: string }
  | { type: 'add'; object: BoardObject }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'delete'; ids: string[] }
  | { type: 'clear' }
  | { type: 'presence'; count: number };
```

## 定数（src/shared/constants.ts）
- `COLOR_PRESETS`: ['#000000', '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa']
- `WIDTH_PRESETS`: [2, 4, 8, 14]
- `DEFAULT_COLOR`, `DEFAULT_WIDTH = 4`, `DEFAULT_LINE_STYLE = 'solid'`, `DEFAULT_FONT_SIZE = 24`
- `TEXT_FONT_FAMILY = "'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif"`
- `ERASER_RADIUS = 12`, `HIT_TOLERANCE = 8`
- `DEFAULT_PRESSURE = 0.5`
- `DASH_PATTERNS: Record<LineStyle, number[]>` — solid: [], dashed: [12, 8], dotted: [2, 6]（線幅で乗算）

## クライアント設計

### state.ts
- `createBoardState()` が返すオブジェクト（クロージャ）で管理：
  - `objects: BoardObject[]`（描画順）
  - `selectedIds: Set<string>`
  - `tool: ToolKind`, `color`, `width`, `lineStyle`, `fontSize`
  - `myObjectIds: string[]`（Undo用：自分が追加したIDのスタック）
  - 操作関数: `addObject`, `moveObjects(ids, dx, dy)`, `deleteObjects(ids)`, `clear()`, `setSelection(ids)`
  - 変更通知: `subscribe(listener)` → 変更のたびに listener を呼ぶ（renderer が再描画）
- 操作は「ローカル適用」と「送信」を分ける。tools.ts からは `applyAndSend` 的なラッパー（main.ts で結線）を呼ぶ。受信時は state のみ更新。

### renderer.ts
- `createRenderer(canvas)`: `devicePixelRatio` を考慮してキャンバスサイズを設定。`resize()` はウィンドウ変化時に呼ぶ
- `render(objects, selectedIds, inProgressStroke?)`: 全消去 → 全オブジェクト描画 → 選択オブジェクトにバウンディングボックス（破線枠）
- ストローク描画: 筆圧対応のため、セグメントごとに `lineWidth = width * (0.5 + p)` として `lineTo` で描く。`lineCap/lineJoin = 'round'`。`setLineDash` で lineStyle 反映
- テキスト描画: `font = ${fontSize}px ${TEXT_FONT_FAMILY}`、`textBaseline = 'top'`、改行は `\n` で分割し行ごとに描画（行高 = fontSize * 1.3）
- テキストのバウンディングボックス計測用に `measureText(obj)` を公開

### geometry.ts
- `distPointToSegment(p, a, b)`
- `strokeHit(stroke, pt, tolerance)`: いずれかのセグメントとの距離が tolerance + width/2 以下
- `boundsOf(obj, measureText)`: `{x, y, w, h}`
- `rectIntersects(a, b)`, `pointInRect(pt, r)`

### tools.ts
- `attachPointerHandlers(canvas, deps)` で `pointerdown/move/up/cancel` を登録。`setPointerCapture` を使う
- 座標はCSSピクセル（`getBoundingClientRect` 基準）。筆圧は `e.pressure`（0 かつ pointerType が mouse/touch なら `DEFAULT_PRESSURE`）
- pen: pointerdown で新規 StrokeObject を開始、move で点追加（in-progress として描画）、up で `addObject` 送信
- eraser: move 中に `ERASER_RADIUS` で当たるオブジェクトを順次 `deleteObjects`
- select: down 位置にオブジェクトがあれば（未選択なら単一選択して）ドラッグ移動。無ければ矩形選択開始。up で矩形に交差するオブジェクトを選択。移動は up 時に合計 dx,dy で `moveObjects` 送信（move 中はローカルのみ反映）
- text: down 位置で `text-input.ts` のオーバーレイを開く

### text-input.ts
- `openTextInput({x, y, color, fontSize, onCommit, onCancel})`: `<textarea>` をキャンバス上の該当位置に絶対配置、フォントサイズ・色をキャンバス描画と一致させる
- IME対応: `compositionstart/compositionend` を監視し、変換中の Enter は確定扱いにしない。Shift+Enter で改行、Enter で確定、Esc でキャンセル、blur でも確定
- 確定時に空文字なら何も作らない

### sync.ts
- `createSync({ url, room, onMessage, onStatus })`: WebSocket接続、open 時に `join` 送信、close 時は指数バックオフ（最大 10s）で再接続
- `send(msg: ClientMessage)`: 未接続時は無視（ログ出力）
- URL: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

### export.ts
- `downloadPng(canvas, filename)`: 一時キャンバスに白背景を塗り、元キャンバスを合成して `toBlob` → `<a download>` でダウンロード

### toolbar.ts
- ツール切替（ペン/消しゴム/選択/テキスト）、色プリセット＋カラーピッカー、線幅プリセット、線種セレクト、Undo、選択削除、全消去、PNG保存、接続状態・人数表示
- モバイル対応：横スクロール可能なフレックス行、タップしやすいボタンサイズ（最低 40px）

### main.ts
- 各モジュールを生成し結線。`applyAndSend` で state 更新 + sync.send。受信メッセージは state に適用
- room は `URLSearchParams` の `room`。無ければ `crypto.randomUUID().slice(0, 8)` を生成し `history.replaceState` でURLに付加
- キーボード: Ctrl/Cmd+Z で Undo、Delete/Backspace で選択削除（テキスト入力中は除外）

## サーバー設計（src/server/index.ts）
- `http.createServer` で `dist/` を静的配信（存在する場合）。`/ws` パスで `WebSocketServer`（`noServer: true` + `upgrade` 処理）
- `rooms: Map<string, { objects: BoardObject[]; clients: Set<WebSocket> }>`
- `join`: ルーム作成/参加、`init` を本人に送信、`presence` を全員に送信
- `add/move/delete/clear`: ルーム状態を更新し、送信者以外にブロードキャスト
- 切断時: ルームから除外、`presence` 更新、空ルームは削除
- 受信JSONは `type` の検証を行い、不正なメッセージは無視
- ポートは `process.env.PORT ?? 3000`

## npm scripts
- `dev`: `concurrently "vite" "tsx watch src/server/index.ts"`
- `build`: `vite build`
- `start`: `tsx src/server/index.ts`（NODE_ENV=production 相当。dist を配信）
- `typecheck`: `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.server.json`

## vite.config.ts
- `server.proxy['/ws'] = { target: 'ws://localhost:3000', ws: true }`
- `server.host = true`（LAN上のスマホから検証できるように）
