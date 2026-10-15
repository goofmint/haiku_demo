import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import { LIMITS } from '../shared/limits';
import { parseClientMessage } from '../shared/protocol';
import type { ServerMessage } from '../shared/protocol';
import { createRoomStore } from './rooms';
import type { TimerHandle } from './rooms';

/** ping を送る間隔(ms)。次の ping までに pong が無ければ切断する */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** WebSocket の待ち受けパス */
const WS_PATH = '/ws';

/** SPA のエントリーファイル */
const INDEX_FILE = 'index.html';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_INTERNAL_ERROR = 500;

const CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.json', 'application/json; charset=utf-8'],
  ['.woff2', 'font/woff2'],
  ['.map', 'application/json; charset=utf-8'],
]);

/** 拡張子が未知のファイルに付ける汎用の Content-Type(HTTP の慣例) */
const BINARY_CONTENT_TYPE = 'application/octet-stream';

export type StartServerOptions = { port: number; staticDir: string | null };
export type RunningServer = { port: number; close: () => Promise<void> };

type Connection = {
  clientId: string;
  socket: WebSocket;
  alive: boolean;
};

type ErrorCode = 'invalid-message' | 'not-joined' | 'already-joined' | 'room-full';

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function sendError(socket: WebSocket, message: ErrorCode): void {
  send(socket, { type: 'error', message });
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function respondStatus(res: http.ServerResponse, status: number): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(http.STATUS_CODES[status]);
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string): void {
  const contentType = CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? BINARY_CONTENT_TYPE;
  res.writeHead(HTTP_OK, { 'Content-Type': contentType });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) {
      respondStatus(res, HTTP_INTERNAL_ERROR);
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

async function handleStatic(
  root: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    respondStatus(res, HTTP_METHOD_NOT_ALLOWED);
    return;
  }
  const rawUrl = req.url;
  if (rawUrl === undefined) {
    respondStatus(res, HTTP_BAD_REQUEST);
    return;
  }
  const queryIndex = rawUrl.search(/[?#]/);
  const rawPath = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    respondStatus(res, HTTP_BAD_REQUEST);
    return;
  }
  if (pathname.includes('\0')) {
    respondStatus(res, HTTP_BAD_REQUEST);
    return;
  }

  const target = path.resolve(root, `.${path.posix.sep}${pathname}`);
  if (target !== root && !target.startsWith(root + path.sep)) {
    respondStatus(res, HTTP_FORBIDDEN);
    return;
  }

  if (await isFile(target)) {
    serveFile(req, res, target);
    return;
  }
  // 拡張子付きで存在しないパスは資産の欠落なので 404。それ以外は SPA のルートとして index.html を返す
  if (path.extname(target) !== '') {
    respondStatus(res, HTTP_NOT_FOUND);
    return;
  }
  const indexPath = path.join(root, INDEX_FILE);
  if (await isFile(indexPath)) {
    serveFile(req, res, indexPath);
    return;
  }
  respondStatus(res, HTTP_NOT_FOUND);
}

export function startServer(opts: StartServerOptions): Promise<RunningServer> {
  const staticRoot = opts.staticDir === null ? null : path.resolve(opts.staticDir);

  const roomTimers = new Set<TimerHandle>();
  const store = createRoomStore({
    emptyRoomTtlMs: LIMITS.emptyRoomTtlMs,
    maxObjects: LIMITS.maxObjectsPerRoom,
    setTimer: (fn, ms) => {
      const handle = setTimeout(() => {
        roomTimers.delete(handle);
        fn();
      }, ms);
      // 破棄待ちのルームがあってもプロセス終了を妨げない
      handle.unref();
      roomTimers.add(handle);
      return handle;
    },
    clearTimer: (handle) => {
      roomTimers.delete(handle);
      clearTimeout(handle);
    },
  });

  const connections = new Map<string, Connection>();

  const server = http.createServer((req, res) => {
    if (staticRoot === null) {
      respondStatus(res, HTTP_NOT_FOUND);
      return;
    }
    handleStatic(staticRoot, req, res).catch((err) => {
      console.error('静的ファイルの配信に失敗しました', err instanceof Error ? err.message : err);
      if (!res.headersSent) {
        respondStatus(res, HTTP_INTERNAL_ERROR);
      } else {
        res.destroy();
      }
    });
  });

  const wss = new WebSocketServer({ server, path: WS_PATH, maxPayload: LIMITS.maxPayloadBytes });
  // ws は HTTP サーバーの error を wss にも再送出する。リスナーが無いと未処理例外になるため受けておく
  // (listen 失敗は下の server.once('error') で reject する)
  wss.on('error', (err) => {
    console.error('WebSocket サーバーのエラー', err.message);
  });

  function broadcastToOthers(roomId: string, senderId: string, msg: ServerMessage): void {
    for (const id of store.clientsIn(roomId)) {
      if (id === senderId) continue;
      const conn = connections.get(id);
      if (conn !== undefined) send(conn.socket, msg);
    }
  }

  function broadcastToAll(roomId: string, msg: ServerMessage): void {
    for (const id of store.clientsIn(roomId)) {
      const conn = connections.get(id);
      if (conn !== undefined) send(conn.socket, msg);
    }
  }

  function handleMessage(conn: Connection, raw: string): void {
    const msg = parseClientMessage(raw);
    if (msg === null) {
      sendError(conn.socket, 'invalid-message');
      return;
    }
    const roomId = store.roomOf(conn.clientId);

    if (msg.type === 'join') {
      if (roomId !== null) {
        sendError(conn.socket, 'already-joined');
        return;
      }
      const objects = store.join(msg.roomId, conn.clientId);
      send(conn.socket, { type: 'init', clientId: conn.clientId, objects });
      broadcastToAll(msg.roomId, { type: 'presence', count: store.clientsIn(msg.roomId).length });
      return;
    }

    if (roomId === null) {
      sendError(conn.socket, 'not-joined');
      return;
    }

    switch (msg.type) {
      case 'add':
      case 'update':
      case 'move':
      case 'remove':
      case 'clear': {
        const result = store.apply(conn.clientId, msg);
        if (!result.ok) {
          sendError(conn.socket, result.reason);
          return;
        }
        broadcastToOthers(roomId, conn.clientId, msg);
        return;
      }
      case 'draft:start':
      case 'draft:points':
      case 'draft:end':
        broadcastToOthers(roomId, conn.clientId, { ...msg, clientId: conn.clientId });
        return;
    }
  }

  wss.on('connection', (socket) => {
    const conn: Connection = { clientId: randomUUID(), socket, alive: true };
    connections.set(conn.clientId, conn);

    socket.on('pong', () => {
      conn.alive = true;
    });

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        sendError(socket, 'invalid-message');
        return;
      }
      handleMessage(conn, rawDataToString(data));
    });

    socket.on('error', (err) => {
      console.error('WebSocket エラー', err.message);
    });

    socket.on('close', () => {
      connections.delete(conn.clientId);
      const left = store.leave(conn.clientId);
      if (left === null) return;
      broadcastToAll(left.roomId, { type: 'presence', count: left.remaining });
      broadcastToAll(left.roomId, { type: 'drafts:drop', clientId: conn.clientId });
    });
  });

  const heartbeat = setInterval(() => {
    for (const conn of connections.values()) {
      if (!conn.alive) {
        conn.socket.terminate();
        continue;
      }
      conn.alive = false;
      conn.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  function close(): Promise<void> {
    clearInterval(heartbeat);
    for (const conn of connections.values()) {
      conn.socket.terminate();
    }
    return new Promise<void>((resolve, reject) => {
      wss.close(() => {
        server.close((err) => {
          for (const handle of roomTimers) clearTimeout(handle);
          roomTimers.clear();
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
        server.closeAllConnections();
      });
    });
  }

  return new Promise<RunningServer>((resolve, reject) => {
    const onError = (err: Error): void => {
      clearInterval(heartbeat);
      wss.close();
      reject(err);
    };
    server.once('error', onError);
    server.listen(opts.port, () => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        void close();
        reject(new Error('待ち受けポートを取得できませんでした'));
        return;
      }
      resolve({ port: address.port, close });
    });
  });
}
