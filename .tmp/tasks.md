# タスクリスト: リアルタイム共有ホワイトボード

前提: `.tmp/requirements.md` と `.tmp/design.md`。ブランチ `feature/whiteboard`。

## 進め方
- 実装は Opus サブエージェント(実装担当)に、テストは別の Opus サブエージェント(テスト担当)に依頼する。テスト担当は実装コードを読まず、設計書と下記「モジュール API 契約」だけを根拠にテストを書く。
- 同じファイルを2つのエージェントが同時に編集しないよう、タスクごとに担当ファイルを分ける。
- 各タスクの完了条件: 担当ファイルが `npm run typecheck` と `npm run lint` を通ること。
- アプリの起動・実機確認はユーザーが行う(エージェントは `npm run dev` / `npm start` を実行しない)。
- タスク T1 完了後と、全タスク完了後にコミットする(このディレクトリ配下のファイルだけを add する)。

## 依存関係

```
T1 ─┬─ T2(サーバー)──────────────┐
    ├─ T3(状態・幾何)─ T4(描画)─ T5(入力・ツール)─ T6(接続・UI・結線)─ T8(仕上げ)─ T9(手順書)
    └─ T7a(単体テスト)/ T7b(結合テスト) ※T1 完了後に API 契約だけを見て並行して書く
```

---

## T1. プロジェクト基盤と共通型 [実装担当A]
- [ ] `package.json`(scripts: `dev` / `build` / `start` / `typecheck` / `lint` / `test`、`"type": "module"`)
- [ ] 依存: vite 8, typescript ~6.0, ws 8, @types/ws, zod 4, vitest 5, jsdom, eslint 10, typescript-eslint 8, tsx, concurrently, @types/node
- [ ] `tsconfig.json`(strict、`noUncheckedIndexedAccess`)、`vite.config.ts`(`host: true`、`/ws` proxy、proxy 先ポートは環境変数から取得)、`vitest.config.ts`、`eslint.config.js`(`no-explicit-any` を error)
- [ ] `index.html`(viewport メタ: `width=device-width, initial-scale=1, viewport-fit=cover`)
- [ ] `.env.example`(`PORT`、`VITE_WS_PROXY_TARGET` 等)、`.gitignore`(node_modules, dist, .env)
- [ ] `src/shared/types.ts` / `protocol.ts` / `limits.ts`(下記 API 契約どおり)
- 完了条件: `npm install` が通り、空の `src/client/main.ts` と `src/server/index.ts` を含めて typecheck・lint が通る

## T2. サーバー [実装担当B] (依存: T1)
- [ ] `src/server/rooms.ts`: `createRoomStore`(参加・離脱・操作適用・上限チェック・空ルームの破棄タイマー)
- [ ] `src/server/index.ts`: HTTP + `WebSocketServer`、メッセージ検証、送信者以外への配信、presence、`drafts:drop`、ping/pong、本番時の静的配信、`PORT` 未設定時の起動エラー
- [ ] `startServer({ port, staticDir })` をエクスポートし、結合テストから起動できるようにする
- 対応: FR-9, 設計 4章・5章

## T3. クライアントの状態と幾何 [実装担当C] (依存: T1)
- [ ] `src/client/board.ts`: 順序付きストアと操作適用(無視ルール含む)、変更通知
- [ ] `src/client/history.ts`: Undo/Redo
- [ ] `src/client/camera.ts`: 座標変換、ズーム(範囲制限)、ピンチ用の基点ズーム
- [ ] `src/client/geometry.ts`: BBox、点と線分の距離、オブジェクト当たり判定、矩形交差、出力範囲計算
- 対応: FR-5, FR-8, FR-11, 設計 6.1〜6.3, 6.8

## T4. 描画と PNG 書き出し [実装担当C] (依存: T3)
- [ ] `src/client/render.ts`: 線種(solid / dashed / dotted / marker)、筆圧、なめらか化、テキスト、選択枠、画面外の描画省略
- [ ] `src/client/exportPng.ts`: 出力範囲・倍率計算、白背景、ダウンロード
- 対応: FR-1〜FR-4, FR-10, NFR-3, 設計 6.7, 6.10

## T5. 入力・ツール・テキスト編集 [実装担当D] (依存: T3, T4)
- [ ] `src/client/input.ts`: PointerEvent 集約、coalesced events、2本指ピンチ/パン、ペン優先、ホイール、Space+ドラッグ
- [ ] `src/client/tools/pen.ts` / `eraser.ts` / `select.ts` / `text.ts` / `pan.ts`
- [ ] `src/client/textEditor.ts`: textarea オーバーレイ、IME 対応、自動リサイズ、確定・取消、iOS 対策
- 対応: FR-1, FR-4〜FR-7, FR-11, NFR-4, 設計 6.4〜6.6

## T6. 接続・UI・結線 [実装担当D] (依存: T2, T5)
- [ ] `src/client/connection.ts`: 接続、指数バックオフ再接続、状態通知、送信キュー無し(切断中は編集禁止)
- [ ] `src/client/messages.ts` / `config.ts`: UI 文言と UI 定数
- [ ] `src/client/toolbar.ts` / `styles.css`: レスポンシブなツールバー、インライン SVG アイコン、接続状態・参加人数
- [ ] `src/client/main.ts`: ルーム ID の決定、各モジュールの結線、キーボードショートカット、共有ボタン
- 対応: FR-2, FR-3, FR-5, FR-8〜FR-10, 設計 6.9, 6.11

## T7a. 単体テスト [テスト担当E] (依存: T1。実装は読まない)
- [ ] `tests/geometry.test.ts` / `board.test.ts` / `history.test.ts` / `camera.test.ts` / `protocol.test.ts` / `rooms.test.ts` / `exportBounds.test.ts`
- 根拠は設計書と API 契約のみ。仕様に書かれていない挙動はテストしない

## T7b. 結合テスト [テスト担当F] (依存: T1。実装は読まない)
- [ ] `tests/server.integration.test.ts`: `startServer` をポート 0 で起動し、2〜3 クライアントで init / add / update / move / remove / clear / draft / presence / drafts:drop / 不正メッセージの error / 上限超過を検証

## T8. 仕上げ [オーケストレーター] (依存: T2〜T7)
- [ ] 全テスト実行。失敗は「実装の誤り」か「テストの誤読」かを設計書に照らして判定し、該当エージェントに修正を依頼
- [ ] `npm run typecheck` / `npm run lint` / `npm run build` が通ること
- [ ] `README.md`(概要、セットアップ、起動方法、LAN 内の端末からの接続方法、操作方法)
- [ ] コードレビュー(CodeRabbit レビュー)と指摘対応

## T9. 手動確認手順書 [オーケストレーター] (依存: T8)
- [ ] `.tmp/manual-verification.md`: PC / iPad + Apple Pencil / スマホでの確認手順、期待結果、チェックリスト(筆圧、IME、ピンチ、PNG、2端末同期、再接続)

---

## モジュール API 契約
実装担当とテスト担当が共有する公開 API。ここに無い関数は内部実装として自由に作ってよい。

### `src/shared/limits.ts`
```ts
export const LIMITS: {
  maxPayloadBytes: 1_048_576; maxPointsPerStroke: 5000; maxTextLength: 5000;
  maxObjectsPerRoom: 10_000; roomIdPattern: RegExp /* ^[A-Za-z0-9_-]{1,64}$ */;
  emptyRoomTtlMs: 3_600_000;
};
```

### `src/shared/protocol.ts`
```ts
export const clientMessageSchema: z.ZodType<ClientMessage>;
export const serverMessageSchema: z.ZodType<ServerMessage>;
export type ClientMessage = /* design.md 4章の C→S メッセージの判別共用体 */;
export type ServerMessage = /* design.md 4章の S→C メッセージの判別共用体 */;
// 文字列を受け取り、JSON として不正またはスキーマ不一致なら null を返す
export function parseClientMessage(raw: string): ClientMessage | null;
export function parseServerMessage(raw: string): ServerMessage | null;
```
検証ルール: 点の x,y とテキストの x,y は絶対値 `LIMITS.maxCoordinate` 以下。color は `^#[0-9a-fA-F]{6}$`、width は 0 より大きく 200 以下、fontSize は 4〜400、pressure の p は 0〜1、points は 1 点以上 `maxPointsPerStroke` 以下、text は `maxTextLength` 以下、ids は 1 件以上、数値は有限値のみ。

### `src/server/rooms.ts`
```ts
export type OpResult = { ok: true } | { ok: false; reason: 'room-full' | 'not-joined' };
export function createRoomStore(opts: { emptyRoomTtlMs: number; maxObjects: number;
  setTimer: (fn: () => void, ms: number) => TimerHandle; clearTimer: (h: TimerHandle) => void }): {
  join(roomId: string, clientId: string): BoardObject[];   // 現在のオブジェクト(重なり順)
  leave(clientId: string): { roomId: string; remaining: number } | null;
  apply(clientId: string, msg: ClientMessage): OpResult;   // add/update/move/remove/clear を状態に反映
  snapshot(roomId: string): BoardObject[];
  clientsIn(roomId: string): string[];
  roomOf(clientId: string): string | null;
};
```
規則: 重複 id の add・存在しない id への update/move/remove は無視(ok: true)。move の結果、対象のどれか1つでも座標の絶対値が `LIMITS.maxCoordinate`(10,000,000)を超えるなら move 全体を拒否し(`{ ok: false, reason: 'invalid-message' }`、状態は変えない)、サーバーは送信者に `error: invalid-message` を返して配信しない。add で上限を超えるならその add 全体を拒否(`room-full`)。最後の1人が leave したら TTL 後に破棄、TTL 前に誰かが join したらタイマー取消。draft 系は状態を変えない(ok: true)。

### `src/server/index.ts`
```ts
export function startServer(opts: { port: number; staticDir: string | null }):
  Promise<{ port: number; close: () => Promise<void> }>;  // port 0 なら実際のポートを返す
```
挙動: 参加後に `init` を本人へ、`presence` を全員へ。操作は送信者以外へ配信(draft 系は `clientId` を付与)。切断時に `presence` と `drafts:drop` を残りへ。不正メッセージ・未参加での操作・上限超過には `error` を本人へ返し、接続は切らない。
`error.message` の値は次のコード文字列に固定する: `invalid-message`(JSON/スキーマ不正)、`not-joined`(join 前の操作)、`already-joined`(2回目の join)、`room-full`(オブジェクト上限超過。この場合は配信もしない)。
起動処理は `src/server/main.ts`(`PORT` を読み、未設定・不正なら throw。`NODE_ENV=production` のとき `dist/` を配信)に分け、`index.ts` は import しても自動起動しない。

### `src/client/board.ts`
```ts
export type BoardOp =
  | { type: 'add'; objects: BoardObject[] } | { type: 'update'; object: BoardObject }
  | { type: 'move'; ids: string[]; dx: number; dy: number } | { type: 'remove'; ids: string[] }
  | { type: 'clear' };
export function createBoard(): {
  apply(op: BoardOp): void;          // 無視ルールは rooms と同じ
  reset(objects: BoardObject[]): void;
  get(id: string): BoardObject | undefined;
  list(): BoardObject[];             // 重なり順(下→上)
  subscribe(fn: () => void): () => void;
};
```

### `src/client/history.ts`
```ts
export type Command =
  | { type: 'add'; objects: BoardObject[] } | { type: 'remove'; objects: BoardObject[] }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'update'; before: BoardObject; after: BoardObject };
export function createHistory(): {
  push(cmd: Command): void;                       // redo スタックを空にする
  undo(exists: (id: string) => boolean): BoardOp | null;  // 逆操作。存在しない id は除外、全部消えていれば次の履歴へ進む
  redo(exists: (id: string) => boolean): BoardOp | null;
  clear(): void; canUndo(): boolean; canRedo(): boolean;
};
```
clear 操作は `{ type: 'remove', objects: 全オブジェクト }` として push する。remove の Undo は add(元の objects)を返し、add 対象 id が既に存在するものは除外する。

### `src/client/camera.ts`
```ts
export type Camera = { x: number; y: number; zoom: number };  // screen = (world - {x,y}) * zoom
export const MIN_ZOOM = 0.1; export const MAX_ZOOM = 8;
export function screenToWorld(c: Camera, sx: number, sy: number): { x: number; y: number };
export function worldToScreen(c: Camera, wx: number, wy: number): { x: number; y: number };
export function zoomAt(c: Camera, sx: number, sy: number, factor: number): Camera; // 画面上の点を固定してズーム、範囲で clamp
export function panBy(c: Camera, dsx: number, dsy: number): Camera;  // 画面座標の移動量
```

### `src/client/geometry.ts`
```ts
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };
export function distancePointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number;
export function strokeBounds(s: StrokeObject): Rect;           // 線幅の半分を含む
export function textBounds(t: TextObject, measure: (line: string, fontSize: number) => number): Rect; // 行高 1.3
export function hitTest(objects: BoardObject[], x: number, y: number, tolerance: number,
  measure: (line: string, fontSize: number) => number): BoardObject | null;  // 上から順に判定
export function rectsIntersect(a: Rect, b: Rect): boolean;     // 辺が接するだけでも true
export function exportBounds(rects: Rect[], padding: number): Rect | null;   // 空配列なら null
export function exportScale(bounds: Rect, preferredScale: number, maxSide: number): number;
```
stroke の当たり判定: いずれかの線分(1点のみなら点)との距離 ≤ 線幅/2 + tolerance。marker は当たり判定・`strokeBounds` とも描画幅(線幅×3)を使う。筆圧付き solid も基準線幅(最大幅)で判定する。
