import WebSocket from 'ws';
import { parseServerMessage } from '../../src/shared/protocol';
import type { ClientMessage, ServerMessage } from '../../src/shared/protocol';
import type { BoardObject } from '../../src/shared/types';

export type MessageOfType<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

type Predicate = (m: ServerMessage) => boolean;

type Waiter = {
  predicate: Predicate;
  resolve: (m: ServerMessage) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type TestClient = {
  /** スキーマに沿ったメッセージを送る */
  send(msg: ClientMessage): void;
  /** 任意の文字列をそのまま送る(不正メッセージの検証用) */
  sendRaw(raw: string): void;
  /** predicate に一致する次のメッセージを取り出す。一致しないメッセージはキューに残る */
  next(predicate?: Predicate, timeoutMs?: number): Promise<ServerMessage>;
  /** 指定 type の次のメッセージを取り出す */
  nextOfType<T extends ServerMessage['type']>(type: T, timeoutMs?: number): Promise<MessageOfType<T>>;
  /** ms 待ったあと、predicate に一致するメッセージが届いていないことを確認する */
  expectNoMessage(ms: number, predicate?: Predicate): Promise<void>;
  /** まだ取り出されていないメッセージ */
  queued(): ServerMessage[];
  isOpen(): boolean;
  close(): Promise<void>;
};

export const DEFAULT_TIMEOUT_MS = 2000;

const matchAll: Predicate = () => true;

function rawToString(data: WebSocket.RawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return data.toString('utf8');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function connect(port: number): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queue: ServerMessage[] = [];
  const waiters: Waiter[] = [];
  const invalidRaw: string[] = [];

  const failOnInvalid = (): void => {
    if (invalidRaw.length > 0) {
      throw new Error(`server sent message(s) that parseServerMessage rejected: ${invalidRaw.join(' | ')}`);
    }
  };

  ws.on('message', (data) => {
    const raw = rawToString(data);
    const msg = parseServerMessage(raw);
    if (msg === null) {
      invalidRaw.push(raw.slice(0, 500));
      for (const w of waiters.splice(0)) {
        clearTimeout(w.timer);
        w.reject(new Error(`server sent invalid message: ${raw.slice(0, 500)}`));
      }
      return;
    }
    const idx = waiters.findIndex((w) => w.predicate(msg));
    const waiter = idx >= 0 ? waiters[idx] : undefined;
    if (waiter) {
      waiters.splice(idx, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
      return;
    }
    queue.push(msg);
  });

  const describeQueue = (): string =>
    queue.map((m) => JSON.stringify(m).slice(0, 200)).join(', ') || '(empty)';

  const next = (predicate: Predicate = matchAll, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ServerMessage> => {
    try {
      failOnInvalid();
    } catch (e) {
      return Promise.reject(e);
    }
    const idx = queue.findIndex(predicate);
    const found = idx >= 0 ? queue[idx] : undefined;
    if (found) {
      queue.splice(idx, 1);
      return Promise.resolve(found);
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error(`timed out after ${timeoutMs}ms waiting for message; queued: ${describeQueue()}`));
        }, timeoutMs),
      };
      waiters.push(waiter);
    });
  };

  const client: TestClient = {
    send(msg) {
      ws.send(JSON.stringify(msg));
    },
    sendRaw(raw) {
      ws.send(raw);
    },
    next,
    async nextOfType(type, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const isType = (m: ServerMessage): m is MessageOfType<typeof type> => m.type === type;
      const m = await next(isType, timeoutMs);
      if (!isType(m)) {
        throw new Error(`expected message of type ${type}, got ${m.type}`);
      }
      return m;
    },
    async expectNoMessage(ms, predicate = matchAll) {
      await delay(ms);
      failOnInvalid();
      const unexpected = queue.filter(predicate);
      if (unexpected.length > 0) {
        throw new Error(
          `expected no message, but received: ${unexpected.map((m) => JSON.stringify(m).slice(0, 200)).join(', ')}`,
        );
      }
    },
    queued() {
      return [...queue];
    },
    isOpen() {
      return ws.readyState === WebSocket.OPEN;
    },
    close() {
      return new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }
        ws.once('close', () => resolve());
        ws.close();
      });
    },
  };

  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(client));
    ws.once('error', (err) => reject(err));
  });
}

export type JoinResult = { clientId: string; objects: BoardObject[]; presence: number };

/** join を送り、本人宛ての init と presence を受け取る */
export async function joinRoom(client: TestClient, roomId: string): Promise<JoinResult> {
  client.send({ type: 'join', roomId });
  const init = await client.nextOfType('init');
  const presence = await client.nextOfType('presence');
  return { clientId: init.clientId, objects: init.objects, presence: presence.count };
}
