import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './index';

const MIN_PORT = 1;
const MAX_PORT = 65_535;

/** 本番ビルドの出力先(プロジェクトルートからの相対パス) */
const DIST_DIR_NAME = 'dist';

/** このファイル(src/server/main.ts)からプロジェクトルートへの相対パス */
const PROJECT_ROOT_FROM_HERE = path.join('..', '..');

function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw.trim() === '') {
    throw new Error('環境変数 PORT が設定されていません。.env.example を参考に .env に PORT を設定してください');
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`環境変数 PORT の値が整数ではありません: "${raw}"`);
  }
  const port = Number(raw.trim());
  if (port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`環境変数 PORT は ${MIN_PORT}〜${MAX_PORT} の範囲で指定してください: "${raw}"`);
  }
  return port;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, PROJECT_ROOT_FROM_HERE);
const staticDir = process.env.NODE_ENV === 'production' ? path.resolve(projectRoot, DIST_DIR_NAME) : null;

const port = readPort();
const running = await startServer({ port, staticDir });
const mode = staticDir === null ? '開発モード(静的配信なし)' : `本番モード(${staticDir} を配信)`;
console.log(`サーバーを起動しました: http://localhost:${running.port} ${mode}`);
console.log(`WebSocket: ws://localhost:${running.port}/ws`);
