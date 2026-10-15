# 設計書: リアルタイム共有ホワイトボード

要件: `.tmp/requirements.md`(FR-1〜FR-11, NFR-1〜NFR-6)

## 1. 技術構成

| 区分 | 採用 | バージョン(2026-10-15 時点の npm 最新) |
|---|---|---|
| 言語 | TypeScript | 6.0.x(`typescript-eslint` の対応上限が `<6.1.0` のため 7.x は使わない) |
| フロント | Vite + 素の TS + Canvas 2D | vite 8.x |
| サーバー | Node.js + `ws` | ws 8.x / Node 25 |
| メッセージ検証 | zod | 4.x |
| テスト | vitest(+ jsdom は必要な箇所のみ) | 5.x |
| Lint | eslint + typescript-eslint(flat config) | eslint 10.x / ts-eslint 8.x |
| 開発実行 | tsx(サーバー)、concurrently(同時起動) | |

TS のルール: `any` / `unknown` を書かない、`class` を使わない(関数 + クロージャ + プレーンオブジェクトで構成)。
`JSON.parse` の戻り値は直接型注釈せず、zod スキーマの `safeParse` に渡して型を確定させる。

## 2. ディレクトリ構成

```
haiku_demo_fable/
├── package.json / tsconfig.json / vite.config.ts / eslint.config.js / vitest.config.ts
├── index.html
├── src/
│   ├── shared/                # クライアント・サーバー共通
│   │   ├── types.ts           # BoardObject などのドメイン型
│   │   ├── protocol.ts        # zod スキーマとメッセージ型
│   │   └── limits.ts          # 上限値(点数・文字数・ペイロード等)
│   ├── client/
│   │   ├── main.ts            # 起動・各モジュールの結線
│   │   ├── messages.ts        # UI 文言(日本語)を1か所に集約
│   │   ├── config.ts          # 色プリセット・太さ範囲などの UI 定数
│   │   ├── board.ts           # オブジェクトストア(順序付き Map)と操作の適用
│   │   ├── history.ts         # Undo/Redo(自分の操作のみ)
│   │   ├── camera.ts          # パン・ズーム、座標変換
│   │   ├── geometry.ts        # バウンディングボックス・当たり判定
│   │   ├── render.ts          # Canvas 描画(線種・筆圧・テキスト・選択枠)
│   │   ├── input.ts           # PointerEvent の集約、ピンチ判定
│   │   ├── tools/             # pen.ts / eraser.ts / select.ts / text.ts / pan.ts
│   │   ├── textEditor.ts      # textarea オーバーレイ(IME 対応)
│   │   ├── connection.ts      # WebSocket 接続・再接続・送受信
│   │   ├── exportPng.ts       # PNG 書き出し
│   │   ├── toolbar.ts         # ツールバー DOM 構築とイベント
│   │   └── styles.css
│   └── server/
│       ├── index.ts           # HTTP(本番時は dist を配信)+ WebSocket
│       └── rooms.ts           # ルーム状態の管理(純粋ロジック、テスト対象)
└── tests/                     # vitest
```

## 3. データモデル(`src/shared/types.ts`)

```ts
type Point = { x: number; y: number; p: number };   // ワールド座標、p は筆圧 0〜1

type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'marker';

type StrokeObject = {
  id: string;            // crypto.randomUUID()
  kind: 'stroke';
  points: Point[];
  color: string;         // '#rrggbb'
  width: number;         // 基準線幅(ワールド単位)
  style: StrokeStyle;
  pressure: boolean;     // 描画時に筆圧を使ったか
};

type TextObject = {
  id: string;
  kind: 'text';
  x: number; y: number;  // 左上のワールド座標
  text: string;          // 改行を含む
  color: string;
  fontSize: number;
};

type BoardObject = StrokeObject | TextObject;
```

移動はオブジェクト自体の座標(stroke の全 points / text の x,y)を書き換える。オフセット項目は持たない。

## 4. 通信プロトコル(`src/shared/protocol.ts`)

すべて JSON。zod の discriminated union(`type` フィールド)で検証する。

### クライアント → サーバー
| type | ペイロード | 意味 |
|---|---|---|
| `join` | `roomId` | ルーム参加 |
| `add` | `objects: BoardObject[]` | オブジェクト追加(Undo の復元にも使う) |
| `update` | `object: BoardObject` | 既存オブジェクトの置き換え(テキスト再編集) |
| `move` | `ids: string[], dx, dy` | 平行移動 |
| `remove` | `ids: string[]` | 削除 |
| `clear` | なし | 全消去 |
| `draft:start` | `object: StrokeObject` | 描画中の線の開始 |
| `draft:points` | `id, points: Point[]` | 描画中の線への点追加(1フレーム分ずつまとめて送る) |
| `draft:end` | `id` | 描画中の線の破棄(確定時は `add` を送ってから `draft:end`) |

### サーバー → クライアント
| type | ペイロード |
|---|---|
| `init` | `clientId, objects: BoardObject[]`(参加時の全量) |
| `presence` | `count` |
| `add` / `update` / `move` / `remove` / `clear` | 上と同じ(送信者には返さない) |
| `draft:start` / `draft:points` / `draft:end` | 上と同じ + `clientId` |
| `drafts:drop` | `clientId`(切断したクライアントの描画中の線を消す) |
| `error` | `message`(検証失敗時) |

### 一貫性の扱い
- サーバーが正。クライアントは自分の操作を即座にローカル適用し(楽観的更新)、サーバーは受信順に適用して送信者以外へ配信する。
- 存在しない id への `update`/`move`/`remove`、重複 id の `add` はサーバー・クライアントとも無視する。
- `move` は差分なので同時移動でも全員の結果が一致する。
- 既知の制約: 同時に追加された2つのオブジェクトの重なり順は、クライアント間で食い違うことがある(再接続すれば揃う)。今回は許容する。
- 描画中の線(draft)はサーバーに保存しない。後から参加した人には確定済みの線だけが見える。

### 上限(`limits.ts`)
- WebSocket 1メッセージ最大 1MB(`ws` の `maxPayload`)
- 1ストロークの点数 最大 5,000、テキスト 最大 5,000 文字
- 1ルームのオブジェクト数 最大 10,000(超えた `add` は拒否して `error`)
- roomId は `^[A-Za-z0-9_-]{1,64}$`
- 座標の絶対値は 10,000,000 以下(`maxCoordinate`)。move の結果がこれを超える場合は move 全体を拒否する
- クライアントは `error` の `room-full` / `invalid-message` を受けたら、楽観的に反映した操作を取り消すため再接続して `init` で状態を取り直す

## 5. サーバー(`src/server`)

- `rooms.ts`: `createRoomStore()` が `{ join, leave, apply, snapshot }` を返す純粋ロジック。ルームは `Map<roomId, { objects: Map<id, BoardObject>, clients: Set<clientId> }>`。Map の挿入順を重なり順とする。
- 最後の1人が抜けたルームは 1 時間後に破棄する(その間に誰か戻れば保持)。
- `index.ts`: `http.createServer` に `WebSocketServer({ server, path: '/ws', maxPayload })` を載せる。本番時(`NODE_ENV=production`)は `dist/` の静的ファイルを配信する。ポートは環境変数 `PORT` で必ず指定する。未設定なら起動エラーにする(既定値へのフォールバックはしない)。使う値は `.env.example` と README に書く。
- ping/pong で死活監視(30 秒間隔)。

## 6. クライアント

### 6.1 状態
- `board.ts`: `createBoard()` が順序付き Map と `apply(op)` を持つ。ローカル操作とリモート操作を同じ関数で適用する。変更時に再描画を予約する。
- 描画中の線: 自分の分は pen ツールが保持、他人の分は `Map<draftId, StrokeObject>` で保持。

### 6.2 Undo / Redo(`history.ts`)
自分の操作だけをコマンドとして積む。逆操作は通常の操作として送信する。
| 操作 | 逆操作 |
|---|---|
| add(objs) | remove(ids) |
| remove(objs) / clear(objs) | add(objs)(元の重なり順は末尾に戻る) |
| move(ids, dx, dy) | move(ids, -dx, -dy) |
| update(before, after) | update(before) |

逆操作の対象が他人に消されていた場合はその id をスキップする。`init` 受信(再接続)時は履歴を空にする。

### 6.3 座標・カメラ(`camera.ts`)
- `{ x, y, zoom }`。`screenToWorld` / `worldToScreen`。ズーム範囲 0.1〜8。
- Canvas は `devicePixelRatio` 倍の解像度で確保し、`ResizeObserver` で追従(NFR-3)。

### 6.4 入力(`input.ts`)
- Canvas に `touch-action: none`、`user-select: none`、`contextmenu` 抑止(NFR-4)。
- PointerEvent に統一。`getCoalescedEvents()` があれば使い、高頻度の点を拾う。
- タッチポインタが2本になったら、進行中の操作をキャンセル(描きかけの線は破棄)してピンチズーム/2本指パンに切り替える。
- ペン入力中のタッチは無視する(簡易パームリジェクション)。
- PC: ホイールでパン、Ctrl/⌘+ホイール(トラックパッドのピンチ含む)でズーム、Space 押下中のドラッグでパン。

### 6.5 ツール(`tools/`)
共通インターフェース `{ onDown, onMove, onUp, onCancel }`(ワールド座標と pressure / pointerType を受け取る)。

- **pen**: 点を追加しながら draft を送信。`requestAnimationFrame` 単位で点をまとめて `draft:points`。離したら `add` → `draft:end`。点が1つだけなら点(円)として描く。
- **eraser**: 半径 `max(8px/zoom, 線幅)` の円となぞり線分で当たり判定し、当たったオブジェクトを即座に消す。1回のなぞりで消したものは Undo 1回で戻る。
- **select**:
  - 既存の選択範囲内を押してドラッグ → 移動(ドラッグ中はローカルのみ反映、離した時に `move` を1回送信)
  - オブジェクト上を押す → そのオブジェクトを選択(Shift で追加/解除)
  - 何もない所からドラッグ → 矩形範囲選択(バウンディングボックスが矩形と交差するものを選択)
  - Delete / Backspace / 削除ボタン → 選択中を一括削除
- **text**: タップ位置に textarea を表示。既存テキストをダブルクリック/ダブルタップで再編集(どのツールでも有効)。
- **pan**: 1本指でパン(スマホ向け)。

### 6.6 テキスト入力(`textEditor.ts`、FR-7)
- `<textarea>` をキャンバス上に絶対配置し、フォントサイズ・色をカメラに合わせる。
- 入力に合わせて textarea の幅・高さを自動調整。
- Enter は改行。確定は「textarea 外のタップ / Esc / Ctrl(⌘)+Enter」。
- IME: `keydown` で `event.isComposing` または `keyCode === 229` のときはショートカット処理をしない。`compositionstart`〜`compositionend` の間は確定処理を保留する(Safari では `compositionend` の後に `keydown` が来るため、そのフラグも併用)。
- 空文字で確定 → 新規なら作らない、再編集なら削除する。
- iOS で textarea にフォーカスが当たるよう、ユーザー操作の pointerup ハンドラ内で同期的に `focus()` する。font-size 16px 未満だと iOS が自動ズームするため、textarea の CSS font-size は 16px 以上にし、`transform: scale()` で見た目を合わせる。

### 6.7 描画(`render.ts`)
- 変更があったフレームだけ全再描画(`requestAnimationFrame` で間引き)。オブジェクト数 10,000 までを想定。画面外のオブジェクトはバウンディングボックスで描画を省略する。
- 線のなめらか化: 隣接点の中点を結ぶ二次ベジェ曲線。
- 線種:
  - solid: 筆圧 ON かつ pressure 変化がある場合は、区間ごとに `lineWidth = width × (0.2 + 0.8p)` で描く。それ以外は1本のパス
  - dashed: `setLineDash([width×3, width×2])`、dotted: `setLineDash([0.1, width×2])` + `lineCap: round`
  - marker: `globalAlpha 0.35`、太さ×3、1本のパスで描く(重なりによるムラを防ぐため筆圧は無視)
  - 筆圧は solid のみに適用する(破線・点線・マーカーは一定幅)
- テキスト: 1行ずつ `fillText`、行高 1.3、フォントは `system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif`。
- 選択中オブジェクトは青い破線のバウンディングボックス。

### 6.8 当たり判定(`geometry.ts`)
- stroke: 各線分と点の距離 ≤ 線幅/2 + 許容値。事前にバウンディングボックスで粗く判定。
- text: `measureText` で求めた各行の幅の最大値 × 行数 × 行高 の矩形。
- 判定は重なり順の上から行い、最初に当たったものを返す。

### 6.9 接続(`connection.ts`、FR-9)
- URL `?room=<id>`。無ければ `crypto.randomUUID()` の先頭 8 文字で生成し `history.replaceState` で URL に反映。
- 共有ボタンで URL をクリップボードにコピー(`navigator.share` があればそちらを優先)。
- WebSocket URL は `location` から組み立てる(`wss:` / `ws:` を自動判定、パス `/ws`)。開発時は Vite の proxy でサーバーへ転送。
- 切断時は 0.5s → 1s → 2s → 最大 5s の指数バックオフで再接続。
- 切断中は編集を禁止し、「再接続中…」バナーを表示する(オフライン中の操作を後で送ると競合が複雑になるため)。
- 再接続で `init` を受けたらボード全体を置き換え、Undo 履歴を消す。

### 6.10 PNG 書き出し(`exportPng.ts`、FR-10)
- 全オブジェクトのバウンディングボックス + 余白 32px を出力範囲にする。
- オフスクリーン Canvas(倍率 2、ただし一辺 8192px を超える場合は倍率を下げる)に白背景を塗り、同じ `render` 関数で描く。
- `canvas.toBlob('image/png')` → `<a download="whiteboard-YYYYMMDD-HHmmss.png">` でダウンロード。iOS Safari でも `download` 属性で保存可能。
- オブジェクトが無い場合はメッセージ「ボードが空です」を表示し、書き出さない。

### 6.11 UI(`toolbar.ts`)
- PC: 上部に横並びのツールバー。幅 768px 未満: 下部に配置し、横スクロール可能にする。
- 項目: 選択 / ペン / 消しゴム / テキスト / パン | 色プリセット8色 + カラーピッカー | 太さスライダー | 線種セレクト | 筆圧トグル | 文字サイズ | Undo / Redo | 選択削除 / 全消去(確認あり) | PNG | 共有 | 接続状態・参加人数
- ボタンはタップしやすいよう最小 40×40px。アイコンはインライン SVG。
- UI 文言は `messages.ts` に集約(日本語のみ。多言語化はスコープ外)。
- キーボードショートカット(PC): V 選択 / P ペン / E 消しゴム / T テキスト / H パン、Ctrl/⌘+Z、Ctrl/⌘+Shift+Z、Delete。テキスト編集中と IME 変換中は無効。

## 7. 実行方法
- `npm run dev`: サーバー(tsx watch)と Vite を同時起動。Vite は `host: true` で LAN 公開し、同じ Wi-Fi のタブレット・スマホから接続できるようにする。`/ws` はサーバーへ proxy。
- `npm run build`: Vite ビルド + サーバーの型チェック
- `npm start`: 本番モードでサーバーが `dist/` と `/ws` を同一ポートで提供
- ポート番号は `.env.example` に記載し、`PORT` が無い場合はサーバーが起動エラーを出す(フォールバックしない)。

## 8. テスト方針
仕様書をもとに、実装とは別のエージェントがテストを書く。
- 単体: `geometry`(当たり判定・BBox)、`board`(操作適用・無視ルール)、`history`(Undo/Redo と他人に消された場合)、`protocol`(zod 検証の受理・拒否)、`rooms`(参加・配信対象・上限・破棄タイマー)、`camera`(座標変換)、`exportPng` の出力範囲計算
- 結合: 実際の `ws` サーバーをランダムポートで起動し、2クライアント間で add / move / remove / draft / init / presence / drafts:drop を検証
- 手動(ユーザー実施): 実機タブレット・スマホ・ペンでの描画、IME、PNG 保存、複数端末同期。手順書を `.tmp/manual-verification.md` に用意する

## 9. 要件との対応
| 要件 | 設計箇所 |
|---|---|
| FR-1 描画 | 6.5 pen, 6.7 |
| FR-2 色 | 6.11 |
| FR-3 線種 | 6.7, 6.11 |
| FR-4 筆圧 | 6.4, 6.7 |
| FR-5 選択・移動・一括削除 | 6.5 select, 6.8 |
| FR-6 消しゴム | 6.5 eraser |
| FR-7 テキスト | 6.6 |
| FR-8 Undo/Redo | 6.2 |
| FR-9 共有 | 4, 5, 6.9 |
| FR-10 PNG | 6.10 |
| FR-11 パン・ズーム | 6.3, 6.4 |
| NFR-3 高DPI | 6.3 |
| NFR-4 誤動作防止 | 6.4 |
