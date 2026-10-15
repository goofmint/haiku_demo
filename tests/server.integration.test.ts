import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer } from '../src/server/index';
import { LIMITS } from '../src/shared/limits';
import type { ClientMessage } from '../src/shared/protocol';
import type { BoardObject, StrokeObject, TextObject } from '../src/shared/types';
import { connect, joinRoom } from './helpers/wsClient';
import type { TestClient } from './helpers/wsClient';

type RunningServer = Awaited<ReturnType<typeof startServer>>;

/** 自分宛てに来ないことを確かめる待ち時間 */
const QUIET_MS = 150;

let server: RunningServer | null = null;
let clients: TestClient[] = [];

async function newClient(): Promise<TestClient> {
  if (server === null) throw new Error('server not started');
  const c = await connect(server.port);
  clients.push(c);
  return c;
}

function text(id: string, x = 0, y = 0, body = 'hi'): TextObject {
  return { id, kind: 'text', x, y, text: body, color: '#112233', fontSize: 16 };
}

function stroke(id: string): StrokeObject {
  return {
    id,
    kind: 'stroke',
    points: [
      { x: 0, y: 0, p: 0.5 },
      { x: 10, y: 10, p: 0.7 },
    ],
    color: '#ff0000',
    width: 4,
    style: 'solid',
    pressure: true,
  };
}

/** objects を maxPayloadBytes 未満の add メッセージに詰め分ける */
function packAdds(objects: BoardObject[]): ClientMessage[] {
  const overhead = Buffer.byteLength(JSON.stringify({ type: 'add', objects: [] }));
  const limit = LIMITS.maxPayloadBytes - 1024;
  const messages: ClientMessage[] = [];
  let current: BoardObject[] = [];
  let size = overhead;
  for (const o of objects) {
    const s = Buffer.byteLength(JSON.stringify(o)) + 1;
    if (current.length > 0 && size + s > limit) {
      messages.push({ type: 'add', objects: current });
      current = [];
      size = overhead;
    }
    current.push(o);
    size += s;
  }
  if (current.length > 0) messages.push({ type: 'add', objects: current });
  for (const m of messages) {
    expect(Buffer.byteLength(JSON.stringify(m))).toBeLessThan(LIMITS.maxPayloadBytes);
  }
  return messages;
}

beforeEach(async () => {
  server = await startServer({ port: 0, staticDir: null });
  clients = [];
});

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
  if (server !== null) {
    await server.close();
    server = null;
  }
});

describe('startServer', () => {
  it('resolves with a real port when started with port 0', () => {
    expect(server).not.toBeNull();
    expect(server?.port).toBeGreaterThan(0);
  });

  it('responds 404 to HTTP requests when staticDir is null', async () => {
    const res = await fetch(`http://127.0.0.1:${server?.port ?? 0}/`);
    expect(res.status).toBe(404);
    await res.arrayBuffer();
  });
});

describe('join / presence', () => {
  it('sends init (empty board) then presence 1 to the first joiner', async () => {
    const a = await newClient();
    a.send({ type: 'join', roomId: 'room1' });
    const first = await a.next();
    expect(first.type).toBe('init');
    if (first.type !== 'init') return;
    expect(first.clientId.length).toBeGreaterThan(0);
    expect(first.objects).toEqual([]);
    const second = await a.next();
    expect(second).toEqual({ type: 'presence', count: 1 });
  });

  it('sends presence 2 to both clients when a second client joins, with distinct clientIds', async () => {
    const a = await newClient();
    const b = await newClient();
    const ja = await joinRoom(a, 'room1');
    expect(ja.presence).toBe(1);
    const jb = await joinRoom(b, 'room1');
    expect(jb.presence).toBe(2);
    expect(jb.objects).toEqual([]);
    expect(await a.nextOfType('presence')).toEqual({ type: 'presence', count: 2 });
    expect(jb.clientId).not.toBe(ja.clientId);
  });
});

describe('board operations', () => {
  it('broadcasts add to the other client but not back to the sender', async () => {
    const a = await newClient();
    const b = await newClient();
    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    const msg: ClientMessage = { type: 'add', objects: [text('t1', 1, 2), stroke('s1')] };
    a.send(msg);
    expect(await b.nextOfType('add')).toEqual(msg);
    await a.expectNoMessage(QUIET_MS);
  });

  it('broadcasts update / move / remove / clear to the other client', async () => {
    const a = await newClient();
    const b = await newClient();
    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    a.send({ type: 'add', objects: [text('t1'), text('t2')] });
    await b.nextOfType('add');

    const update: ClientMessage = { type: 'update', object: text('t1', 0, 0, 'edited\nline2') };
    a.send(update);
    expect(await b.nextOfType('update')).toEqual(update);

    const move: ClientMessage = { type: 'move', ids: ['t1'], dx: 5, dy: -3 };
    a.send(move);
    expect(await b.nextOfType('move')).toEqual(move);

    const remove: ClientMessage = { type: 'remove', ids: ['t2'] };
    a.send(remove);
    expect(await b.nextOfType('remove')).toEqual(remove);

    a.send({ type: 'clear' });
    expect(await b.nextOfType('clear')).toEqual({ type: 'clear' });

    await a.expectNoMessage(QUIET_MS);
  });

  it('broadcasts in the other direction too (B -> A)', async () => {
    const a = await newClient();
    const b = await newClient();
    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    const msg: ClientMessage = { type: 'add', objects: [stroke('s1')] };
    b.send(msg);
    expect(await a.nextOfType('add')).toEqual(msg);
    await b.expectNoMessage(QUIET_MS);
  });

  it('gives a late joiner all objects in insertion order with moves applied', async () => {
    const a = await newClient();
    const b = await newClient();
    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    a.send({ type: 'add', objects: [text('first', 10, 20)] });
    await b.nextOfType('add');
    a.send({ type: 'add', objects: [stroke('second')] });
    await b.nextOfType('add');
    a.send({ type: 'move', ids: ['first'], dx: 5, dy: -7 });
    await b.nextOfType('move');

    const c = await newClient();
    const jc = await joinRoom(c, 'room1');
    expect(jc.presence).toBe(3);
    expect(jc.objects).toEqual([text('first', 15, 13), stroke('second')]);
  });

  it('keeps z-order on update and reflects remove / clear in later init', async () => {
    const a = await newClient();
    const b = await newClient();
    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    a.send({ type: 'add', objects: [text('o1'), text('o2'), text('o3')] });
    await b.nextOfType('add');
    const edited = text('o1', 0, 0, 'changed');
    a.send({ type: 'update', object: edited });
    await b.nextOfType('update');

    const c = await newClient();
    expect((await joinRoom(c, 'room1')).objects).toEqual([edited, text('o2'), text('o3')]);

    a.send({ type: 'remove', ids: ['o2'] });
    await b.nextOfType('remove');
    const d = await newClient();
    expect((await joinRoom(d, 'room1')).objects).toEqual([edited, text('o3')]);

    a.send({ type: 'clear' });
    await b.nextOfType('clear');
    const e = await newClient();
    expect((await joinRoom(e, 'room1')).objects).toEqual([]);
  });
});

describe('drafts', () => {
  it('relays draft:start / draft:points / draft:end with the sender clientId, and does not persist drafts', async () => {
    const a = await newClient();
    const b = await newClient();
    const ja = await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    const draft = stroke('d1');
    a.send({ type: 'draft:start', object: draft });
    expect(await b.nextOfType('draft:start')).toEqual({ type: 'draft:start', object: draft, clientId: ja.clientId });

    const points = [
      { x: 20, y: 20, p: 0.3 },
      { x: 30, y: 25, p: 1 },
    ];
    a.send({ type: 'draft:points', id: 'd1', points });
    expect(await b.nextOfType('draft:points')).toEqual({
      type: 'draft:points',
      id: 'd1',
      points,
      clientId: ja.clientId,
    });

    a.send({ type: 'draft:end', id: 'd1' });
    expect(await b.nextOfType('draft:end')).toEqual({ type: 'draft:end', id: 'd1', clientId: ja.clientId });

    await a.expectNoMessage(QUIET_MS);

    // 確定していない draft は後から参加した人の init に含まれない
    a.send({ type: 'draft:start', object: stroke('d2') });
    await b.nextOfType('draft:start');
    const c = await newClient();
    expect((await joinRoom(c, 'room1')).objects).toEqual([]);
  });

  it('sends presence and drafts:drop to remaining clients when a client disconnects', async () => {
    const a = await newClient();
    const b = await newClient();
    const ja = await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    a.send({ type: 'draft:start', object: stroke('d1') });
    await b.nextOfType('draft:start');

    await a.close();
    expect(await b.nextOfType('presence')).toEqual({ type: 'presence', count: 1 });
    expect(await b.nextOfType('drafts:drop')).toEqual({ type: 'drafts:drop', clientId: ja.clientId });
  });
});

describe('errors', () => {
  it('returns invalid-message for malformed JSON and keeps the connection usable', async () => {
    const a = await newClient();
    const b = await newClient();
    a.sendRaw('{not json');
    expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'invalid-message' });
    expect(a.isOpen()).toBe(true);

    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    a.sendRaw('not json at all');
    expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'invalid-message' });
    expect(a.isOpen()).toBe(true);

    const msg: ClientMessage = { type: 'add', objects: [text('t1')] };
    a.send(msg);
    expect(await b.nextOfType('add')).toEqual(msg);
  });

  it('returns invalid-message for schema-invalid messages and keeps the connection usable', async () => {
    const a = await newClient();
    const b = await newClient();

    // roomId の形式違反
    a.sendRaw(JSON.stringify({ type: 'join', roomId: 'bad room!' }));
    expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'invalid-message' });

    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    const invalids = [
      { type: 'unknown-op' },
      { type: 'add', objects: [] },
      { type: 'add', objects: [{ ...text('t1'), color: 'red' }] },
      { type: 'move', ids: ['t1'], dx: 'x', dy: 0 },
      { type: 'remove', ids: [] },
      [1, 2, 3],
    ];
    for (const raw of invalids) {
      a.sendRaw(JSON.stringify(raw));
      expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'invalid-message' });
    }
    expect(a.isOpen()).toBe(true);
    await b.expectNoMessage(QUIET_MS);

    const msg: ClientMessage = { type: 'add', objects: [text('t1')] };
    a.send(msg);
    expect(await b.nextOfType('add')).toEqual(msg);
  });

  it('returns not-joined for operations before join, without applying them', async () => {
    const a = await newClient();
    a.send({ type: 'add', objects: [text('t1')] });
    expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'not-joined' });
    a.send({ type: 'clear' });
    expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'not-joined' });
    expect(a.isOpen()).toBe(true);

    const j = await joinRoom(a, 'room1');
    expect(j.objects).toEqual([]);
  });

  it('returns already-joined for a second join and stays in the original room', async () => {
    const a = await newClient();
    const b = await newClient();
    const other = await newClient();
    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');
    await joinRoom(other, 'room2');

    a.send({ type: 'join', roomId: 'room1' });
    expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'already-joined' });
    a.send({ type: 'join', roomId: 'room2' });
    expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'already-joined' });
    await a.expectNoMessage(QUIET_MS, (m) => m.type === 'init');
    await other.expectNoMessage(0);
    expect(a.isOpen()).toBe(true);

    const msg: ClientMessage = { type: 'add', objects: [text('t1')] };
    a.send(msg);
    expect(await b.nextOfType('add')).toEqual(msg);
    await other.expectNoMessage(QUIET_MS);
  });

  it(
    'rejects adds beyond maxObjectsPerRoom with room-full, without broadcasting',
    { timeout: 15000 },
    async () => {
      const a = await newClient();
      const b = await newClient();
      await joinRoom(a, 'room1');
      await joinRoom(b, 'room1');
      await a.nextOfType('presence');

      const max = LIMITS.maxObjectsPerRoom;
      const minimal = (i: number): TextObject => ({
        id: `o${i}`,
        kind: 'text',
        x: 0,
        y: 0,
        text: '',
        color: '#000000',
        fontSize: 12,
      });

      // 上限 - 1 個まで入れる
      const initial = Array.from({ length: max - 1 }, (_, i) => minimal(i));
      const adds = packAdds(initial);
      for (const m of adds) a.send(m);
      let received = 0;
      while (received < max - 1) {
        const add = await b.nextOfType('add', 5000);
        received += add.objects.length;
      }
      expect(received).toBe(max - 1);

      // 2 個足すと上限を超えるので、add 全体が拒否される
      a.send({ type: 'add', objects: [minimal(max), minimal(max + 1)] });
      expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'room-full' });
      await b.expectNoMessage(QUIET_MS);

      // ちょうど上限までは入る
      const last: ClientMessage = { type: 'add', objects: [minimal(max + 2)] };
      a.send(last);
      expect(await b.nextOfType('add')).toEqual(last);

      // 上限に達した後の add は拒否され、配信もされない
      a.send({ type: 'add', objects: [minimal(max + 3)] });
      expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'room-full' });
      await b.expectNoMessage(QUIET_MS * 2);
      expect(a.isOpen()).toBe(true);

      const c = await newClient();
      const jc = await joinRoom(c, 'room1');
      expect(jc.objects).toHaveLength(max);
      expect(jc.objects[0]?.id).toBe('o0');
      expect(jc.objects[max - 2]?.id).toBe(`o${max - 2}`);
      expect(jc.objects[max - 1]?.id).toBe(`o${max + 2}`);
    },
  );
});

describe('room isolation', () => {
  it('does not leak ops or presence between rooms', async () => {
    const a = await newClient();
    const a2 = await newClient();
    const x = await newClient();
    await joinRoom(a, 'r1');
    await joinRoom(a2, 'r1');
    await a.nextOfType('presence');

    const jx = await joinRoom(x, 'r2');
    expect(jx.presence).toBe(1);
    expect(jx.objects).toEqual([]);

    const msg: ClientMessage = { type: 'add', objects: [text('t1')] };
    a.send(msg);
    expect(await a2.nextOfType('add')).toEqual(msg);
    a.send({ type: 'draft:start', object: stroke('d1') });
    await a2.nextOfType('draft:start');

    // r1 の内容は r2 の参加者に見えない
    const y = await newClient();
    const jy = await joinRoom(y, 'r2');
    expect(jy.presence).toBe(2);
    expect(jy.objects).toEqual([]);
    expect(await x.nextOfType('presence')).toEqual({ type: 'presence', count: 2 });

    const xmsg: ClientMessage = { type: 'add', objects: [text('x1')] };
    x.send(xmsg);
    expect(await y.nextOfType('add')).toEqual(xmsg);

    await a.expectNoMessage(QUIET_MS);
    await a2.expectNoMessage(0);
    await x.expectNoMessage(0);
    await y.expectNoMessage(0);
  });
});

describe('move の座標上限(maxCoordinate)', () => {
  const M = LIMITS.maxCoordinate;

  it('上限を超える move は送信者に invalid-message を返し、他者には配信しない', async () => {
    const a = await newClient();
    const b = await newClient();
    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    const addMsg: ClientMessage = { type: 'add', objects: [text('t1', 9_000_000, 0), text('t2', 0, 0)] };
    a.send(addMsg);
    expect(await b.nextOfType('add')).toEqual(addMsg);

    a.send({ type: 'move', ids: ['t1', 't2'], dx: 2_000_000, dy: 0 });
    expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'invalid-message' });
    expect(a.isOpen()).toBe(true);
    await b.expectNoMessage(QUIET_MS);
    await a.expectNoMessage(0, (m) => m.type === 'move');

    // 後から参加したクライアントの init は元の座標のまま
    const c = await newClient();
    const jc = await joinRoom(c, 'room1');
    expect(jc.objects).toEqual([text('t1', 9_000_000, 0), text('t2', 0, 0)]);
  });

  it('範囲内に収まる move(ちょうど maxCoordinate)は通常どおり配信される', async () => {
    const a = await newClient();
    const b = await newClient();
    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    a.send({ type: 'add', objects: [text('t1', 9_000_000, 0)] });
    await b.nextOfType('add');

    const move: ClientMessage = { type: 'move', ids: ['t1'], dx: M - 9_000_000, dy: -M };
    a.send(move);
    expect(await b.nextOfType('move')).toEqual(move);
    await a.expectNoMessage(QUIET_MS, (m) => m.type === 'error');

    const c = await newClient();
    const jc = await joinRoom(c, 'room1');
    expect(jc.objects).toEqual([text('t1', M, -M)]);
  });

  it('拒否後も接続は使え、次の操作は配信される', async () => {
    const a = await newClient();
    const b = await newClient();
    await joinRoom(a, 'room1');
    await joinRoom(b, 'room1');
    await a.nextOfType('presence');

    a.send({ type: 'add', objects: [text('t1', M, M)] });
    await b.nextOfType('add');

    a.send({ type: 'move', ids: ['t1'], dx: 0, dy: 1 });
    expect(await a.nextOfType('error')).toEqual({ type: 'error', message: 'invalid-message' });
    await b.expectNoMessage(QUIET_MS);

    const move: ClientMessage = { type: 'move', ids: ['t1'], dx: -1, dy: -1 };
    a.send(move);
    expect(await b.nextOfType('move')).toEqual(move);
  });
});
