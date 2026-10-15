import { createServer, type ServerResponse } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { ClientMessage } from '../src/shared/model.ts';
import { handleOp, isValidRoomId, joinRoom, leaveRoom, snapshotMessage, type Room, type RoomRegistry } from './room.ts';

const PORT = Number(process.env.PORT ?? 3000);
const DIST_DIR = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const MAX_MESSAGE_BYTES = 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const rooms: RoomRegistry = new Map();
const socketRoom = new WeakMap<WebSocket, Room>();

async function serveStatic(urlPath: string, response: ServerResponse): Promise<void> {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = normalize(join(DIST_DIR, requested));
  // Refuse anything that resolves outside the dist directory.
  if (!filePath.startsWith(DIST_DIR)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found. Run `npm run build` first, or use `npm run dev:client` during development.');
  }
}

const httpServer = createServer((request, response) => {
  const urlPath = new URL(request.url ?? '/', 'http://localhost').pathname;
  void serveStatic(urlPath, response);
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

wss.on('connection', (socket) => {
  socket.on('message', (raw: RawData) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (message.type === 'join') {
      if (typeof message.room !== 'string' || !isValidRoomId(message.room)) return;
      const previous = socketRoom.get(socket);
      if (previous) leaveRoom(rooms, previous, socket);
      const room = joinRoom(rooms, message.room, socket);
      socketRoom.set(socket, room);
      socket.send(snapshotMessage(room));
      return;
    }

    if (message.type === 'op') {
      const room = socketRoom.get(socket);
      if (!room) return;
      handleOp(room, socket, message.op);
    }
  });

  socket.on('error', (error: Error) => {
    console.error('WebSocket error:', error.message);
  });

  socket.on('close', () => {
    const room = socketRoom.get(socket);
    if (room) leaveRoom(rooms, room, socket);
    socketRoom.delete(socket);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Whiteboard server listening on http://localhost:${PORT}`);
});
