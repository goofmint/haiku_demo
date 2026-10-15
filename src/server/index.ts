import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, promises as fsPromises } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type {
  BoardObject,
  ClientMessage,
  LineStyle,
  Point,
  ServerMessage,
  StrokeObject,
  TextObject,
} from '../shared/types.js';

// --- JSON 型と構造検証 ---
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === 'string';
}

function isNumber(value: JsonValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isLineStyle(value: JsonValue | undefined): value is LineStyle {
  return value === 'solid' || value === 'dashed' || value === 'dotted';
}

function isPoint(value: JsonValue | undefined): value is Point {
  return isJsonObject(value) && isNumber(value.x) && isNumber(value.y) && isNumber(value.p);
}

function isStrokeObject(value: JsonValue | undefined): value is StrokeObject {
  return (
    isJsonObject(value) &&
    value.kind === 'stroke' &&
    isString(value.id) &&
    Array.isArray(value.points) &&
    value.points.every(isPoint) &&
    isString(value.color) &&
    isNumber(value.width) &&
    isLineStyle(value.lineStyle)
  );
}

function isTextObject(value: JsonValue | undefined): value is TextObject {
  return (
    isJsonObject(value) &&
    value.kind === 'text' &&
    isString(value.id) &&
    isNumber(value.x) &&
    isNumber(value.y) &&
    isString(value.text) &&
    isString(value.color) &&
    isNumber(value.fontSize)
  );
}

function isBoardObject(value: JsonValue | undefined): value is BoardObject {
  return isStrokeObject(value) || isTextObject(value);
}

export function isClientMessage(value: JsonValue): value is ClientMessage {
  if (!isJsonObject(value)) return false;
  switch (value.type) {
    case 'join':
      return isString(value.room) && value.room.length > 0 && value.room.length <= 64;
    case 'add':
      return isBoardObject(value.object);
    case 'move':
      return isStringArray(value.ids) && isNumber(value.dx) && isNumber(value.dy);
    case 'delete':
      return isStringArray(value.ids);
    case 'clear':
      return true;
    default:
      return false;
  }
}

function parseJson(text: string): JsonValue | undefined {
  try {
    const parsed: JsonValue = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

function rawToText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

// --- ルーム管理 ---
type Room = { objects: BoardObject[]; clients: Set<WebSocket> };
type Session = { clientId: string; room: string | null };

const rooms = new Map<string, Room>();
const sessions = new WeakMap<WebSocket, Session>();

function getOrCreateRoom(name: string): Room {
  const existing = rooms.get(name);
  if (existing) return existing;
  const created: Room = { objects: [], clients: new Set() };
  rooms.set(name, created);
  return created;
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMessage, except?: WebSocket): void {
  const payload = JSON.stringify(msg);
  for (const client of room.clients) {
    if (client === except) continue;
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function leaveRoom(ws: WebSocket, session: Session): void {
  if (session.room === null) return;
  const name = session.room;
  session.room = null;
  const room = rooms.get(name);
  if (!room) return;
  room.clients.delete(ws);
  if (room.clients.size === 0) {
    rooms.delete(name);
  } else {
    broadcast(room, { type: 'presence', count: room.clients.size });
  }
}

function handleJoin(ws: WebSocket, session: Session, name: string): void {
  if (session.room !== name) {
    leaveRoom(ws, session);
    getOrCreateRoom(name).clients.add(ws);
    session.room = name;
  }
  const room = getOrCreateRoom(name);
  send(ws, { type: 'init', objects: room.objects, clientId: session.clientId });
  broadcast(room, { type: 'presence', count: room.clients.size });
}

function handleClientMessage(ws: WebSocket, msg: ClientMessage): void {
  const session = sessions.get(ws);
  if (!session) return;

  if (msg.type === 'join') {
    handleJoin(ws, session, msg.room);
    return;
  }

  // join 前のメッセージは無視
  if (session.room === null) return;
  const room = rooms.get(session.room);
  if (!room) return;

  switch (msg.type) {
    case 'add': {
      const object = msg.object;
      if (room.objects.some((o) => o.id === object.id)) return;
      room.objects.push(object);
      broadcast(room, { type: 'add', object }, ws);
      return;
    }
    case 'move': {
      const targets = new Set(msg.ids);
      const { dx, dy } = msg;
      for (const obj of room.objects) {
        if (!targets.has(obj.id)) continue;
        if (obj.kind === 'stroke') {
          for (const pt of obj.points) {
            pt.x += dx;
            pt.y += dy;
          }
        } else {
          obj.x += dx;
          obj.y += dy;
        }
      }
      broadcast(room, { type: 'move', ids: msg.ids, dx, dy }, ws);
      return;
    }
    case 'delete': {
      const targets = new Set(msg.ids);
      room.objects = room.objects.filter((o) => !targets.has(o.id));
      broadcast(room, { type: 'delete', ids: msg.ids }, ws);
      return;
    }
    case 'clear': {
      room.objects = [];
      broadcast(room, { type: 'clear' }, ws);
      return;
    }
  }
}

function handleConnection(ws: WebSocket): void {
  sessions.set(ws, { clientId: randomUUID(), room: null });

  ws.on('message', (data: RawData) => {
    const parsed = parseJson(rawToText(data));
    if (parsed === undefined || !isClientMessage(parsed)) return;
    handleClientMessage(ws, parsed);
  });

  const cleanup = (): void => {
    const session = sessions.get(ws);
    if (session) leaveRoom(ws, session);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
}

// --- 静的配信 ---
const DIST_DIR = resolve(process.cwd(), 'dist');

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!existsSync(DIST_DIR)) {
    sendText(res, 404, 'dist/ not found. run "npm run build" first.');
    return;
  }

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, 'bad request');
    return;
  }

  const requested = resolve(DIST_DIR, `.${decoded}`);
  if (requested !== DIST_DIR && !requested.startsWith(DIST_DIR + sep)) {
    sendText(res, 404, 'not found');
    return;
  }

  // 拡張子なしのパスは SPA として index.html を返す
  const target = extname(requested) === '' ? resolve(DIST_DIR, 'index.html') : requested;
  const contentType = CONTENT_TYPES[extname(target)];
  if (!contentType) {
    sendText(res, 404, 'not found');
    return;
  }

  try {
    const data = await fsPromises.readFile(target);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    sendText(res, 404, 'not found');
  }
}

// --- サーバー起動 ---
const PORT = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  serveStatic(req, res).catch(() => {
    sendText(res, 500, 'internal error');
  });
});

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', handleConnection);

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  console.log(`whiteboard server listening on http://localhost:${PORT} (ws: /ws)`);
});
