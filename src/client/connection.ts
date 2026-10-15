import type { ClientMessage, ServerMessage } from '../shared/protocol';
import { parseServerMessage } from '../shared/protocol';
import {
  RECONNECT_BACKOFF_FACTOR,
  RECONNECT_INITIAL_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  WS_PATH,
} from './config';

/** connected は init を受信した後 */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting';

export type Connection = {
  /** 接続を開始する(1回だけ呼ぶ) */
  start(): void;
  /** 接続が開いていなければ黙って捨てる(切断中は編集自体を禁止しているため) */
  send(msg: ClientMessage): void;
  onMessage(fn: (msg: ServerMessage) => void): () => void;
  onStateChange(fn: (state: ConnectionState) => void): () => void;
  getState(): ConnectionState;
  /** 接続を切って再接続し、init でサーバーの状態を取り直す */
  resync(): void;
};

/** ページの location から WebSocket の URL を組み立てる */
export function webSocketUrl(loc: Location): string {
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${loc.host}${WS_PATH}`;
}

export function createConnection(opts: { url: string; roomId: string }): Connection {
  let socket: WebSocket | null = null;
  let state: ConnectionState = 'connecting';
  let attempt = 0;
  let started = false;
  const messageListeners = new Set<(msg: ServerMessage) => void>();
  const stateListeners = new Set<(state: ConnectionState) => void>();

  function setState(next: ConnectionState): void {
    if (state === next) return;
    state = next;
    for (const fn of [...stateListeners]) fn(next);
  }

  function nextDelay(): number {
    const delay = Math.min(
      RECONNECT_INITIAL_DELAY_MS * RECONNECT_BACKOFF_FACTOR ** attempt,
      RECONNECT_MAX_DELAY_MS,
    );
    attempt++;
    return delay;
  }

  function handleMessage(data: string | ArrayBuffer | Blob): void {
    if (typeof data !== 'string') {
      console.warn('Ignored a non-text WebSocket message');
      return;
    }
    const msg = parseServerMessage(data);
    if (!msg) {
      console.warn('Ignored an invalid server message', data);
      return;
    }
    if (msg.type === 'init') {
      attempt = 0;
      setState('connected');
    }
    for (const fn of [...messageListeners]) fn(msg);
  }

  function connect(): void {
    const ws = new WebSocket(opts.url);
    socket = ws;
    ws.addEventListener('open', () => {
      const join: ClientMessage = { type: 'join', roomId: opts.roomId };
      ws.send(JSON.stringify(join));
    });
    ws.addEventListener('message', (e: MessageEvent<string | ArrayBuffer | Blob>) => {
      handleMessage(e.data);
    });
    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      socket = null;
      setState('reconnecting');
      setTimeout(connect, nextDelay());
    });
    // error の後には必ず close が来るので、再接続は close 側で行う
  }

  return {
    start() {
      if (started) return;
      started = true;
      connect();
    },
    send(msg) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(msg));
    },
    onMessage(fn) {
      messageListeners.add(fn);
      return () => {
        messageListeners.delete(fn);
      };
    },
    onStateChange(fn) {
      stateListeners.add(fn);
      return () => {
        stateListeners.delete(fn);
      };
    },
    getState() {
      return state;
    },
    resync() {
      // close ハンドラが再接続し、init でボードと履歴が置き換わる
      socket?.close();
    },
  };
}
