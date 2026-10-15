import type { ClientMessage, ServerMessage } from '../shared/types.js';

export type SyncStatus = 'connecting' | 'connected' | 'disconnected';
export type SyncDeps = {
  room: string;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: SyncStatus) => void;
};
export type Sync = {
  send: (msg: ClientMessage) => void;
  close: () => void;
};

const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10000;

const SERVER_MESSAGE_TYPES: readonly string[] = ['init', 'add', 'move', 'delete', 'clear', 'presence'];

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function parseJson(text: string): JsonValue | undefined {
  try {
    const parsed: JsonValue = JSON.parse(text);
    return parsed;
  } catch {
    return undefined;
  }
}

function isServerMessage(value: JsonValue): value is ServerMessage {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const type = value.type;
  return typeof type === 'string' && SERVER_MESSAGE_TYPES.includes(type);
}

export function createSync(deps: SyncDeps): Sync {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  let socket: WebSocket | null = null;
  let closedByUser = false;
  let backoffMs = INITIAL_BACKOFF_MS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleReconnect(): void {
    const delay = backoffMs;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    deps.onStatus('connecting');
    const ws = new WebSocket(url);
    socket = ws;

    ws.addEventListener('open', () => {
      backoffMs = INITIAL_BACKOFF_MS;
      const join: ClientMessage = { type: 'join', room: deps.room };
      ws.send(JSON.stringify(join));
      deps.onStatus('connected');
    });

    ws.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data !== 'string') {
        console.warn('[sync] ignoring non-text message');
        return;
      }
      const parsed = parseJson(data);
      if (parsed === undefined || !isServerMessage(parsed)) {
        console.warn('[sync] ignoring invalid message');
        return;
      }
      deps.onMessage(parsed);
    });

    ws.addEventListener('close', () => {
      if (socket === ws) socket = null;
      deps.onStatus('disconnected');
      if (!closedByUser) scheduleReconnect();
    });
  }

  function send(msg: ClientMessage): void {
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      console.warn(`[sync] socket not open; dropping "${msg.type}"`);
      return;
    }
    socket.send(JSON.stringify(msg));
  }

  function close(): void {
    closedByUser = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const current = socket;
    socket = null;
    current?.close();
  }

  connect();

  return { send, close };
}
