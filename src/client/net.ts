import type { ClientMessage, Op, ServerMessage, WhiteboardObject } from '../shared/model.ts';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface NetHandlers {
  onSnapshot: (objects: WhiteboardObject[]) => void;
  onRemoteOp: (op: Op) => void;
  onStatus: (status: ConnectionStatus) => void;
}

export interface Net {
  send: (op: Op) => void;
  close: () => void;
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000];
const MAX_RECONNECT_DELAY_MS = 5000;

function socketUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${location.host}/ws`;
}

/**
 * Keeps a WebSocket open to the room and reconnects with backoff.
 * Ops sent while offline are dropped; the next snapshot from the server replaces local state.
 */
export function connectRoom(room: string, handlers: NetHandlers): Net {
  let socket: WebSocket | null = null;
  let attempt = 0;
  let closedByUser = false;
  let reconnectTimer: number | undefined;

  function open(): void {
    handlers.onStatus('connecting');
    const next = new WebSocket(socketUrl());
    socket = next;

    next.addEventListener('open', () => {
      attempt = 0;
      const join: ClientMessage = { type: 'join', room };
      next.send(JSON.stringify(join));
      handlers.onStatus('online');
    });

    next.addEventListener('message', (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === 'snapshot') handlers.onSnapshot(message.objects);
      else handlers.onRemoteOp(message.op);
    });

    next.addEventListener('close', () => {
      if (socket === next) socket = null;
      if (closedByUser) return;
      handlers.onStatus('offline');
      const delay = RECONNECT_DELAYS_MS[attempt] ?? MAX_RECONNECT_DELAY_MS;
      attempt += 1;
      reconnectTimer = window.setTimeout(open, delay);
    });
  }

  open();

  return {
    send(op: Op) {
      if (socket?.readyState !== WebSocket.OPEN) return;
      const message: ClientMessage = { type: 'op', op };
      socket.send(JSON.stringify(message));
    },
    close() {
      closedByUser = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
