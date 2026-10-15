# Haiku with Fable — ホワイトボード

Webブラウザで動くリアルタイム共有ホワイトボードです。PC・タブレット・スマートフォンに対応しています。

## 機能

- ペン描画（マウス / タッチ / スタイラス。スタイラスは筆圧で線幅が変化）
- 色の変更（プリセット + カラーピッカー）
- 線の太さ（プリセット + スライダー）と線種（実線 / 破線 / 点線）
- 線・テキストをオブジェクトとして管理（選択して移動、一括削除、元に戻す、全消去）
- 消しゴム（なぞったオブジェクトを丸ごと削除）
- テキスト入力（IME / 日本語対応。Enterで確定、Shift+Enterで改行、Escでキャンセル）
- WebSocket によるリアルタイム共有（URL の `?room=xxx` を共有）
- PNGダウンロード

キーボードショートカット: `p` ペン / `e` 消しゴム / `v` 選択 / `t` テキスト / `Ctrl(Cmd)+Z` 元に戻す / `Delete` 選択削除 / `Esc` 選択解除

## 起動方法

```bash
npm install
npm run dev        # http://localhost:5173 （Vite）+ WebSocketサーバー :3000
```

本番相当:

```bash
npm run build
npm start          # http://localhost:3000 で静的ファイルと WebSocket を配信
```

同じLAN内のスマートフォンから試す場合は、`npm run dev` 時に表示される Network の URL を開いてください。

## 構成

- `src/client/` — Vanilla TypeScript + Canvas 2D のクライアント
- `src/server/` — Node.js + `ws` のルーム同期サーバー（状態はメモリ保持。再起動で消えます）
- `src/shared/` — クライアント / サーバー共通の型・定数

## 検証

```bash
npm run typecheck
npm run build
```
