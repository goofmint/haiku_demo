import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoomStore } from '../src/server/rooms';
import type { ClientMessage } from '../src/shared/protocol';
import type { BoardObject } from '../src/shared/types';
import { LIMITS } from '../src/shared/limits';
import { pt, stroke, text } from './fixtures';

type StoreOpts = Parameters<typeof createRoomStore>[0];

const TTL = 60_000;

/** タイマーは vitest のフェイクタイマーで動かし、setTimer / clearTimer はスパイで呼び出しを記録する */
function setup(maxObjects = 100) {
  vi.useFakeTimers();
  const setTimer = vi.fn<StoreOpts['setTimer']>((fn, ms) => setTimeout(fn, ms));
  const clearTimer = vi.fn<StoreOpts['clearTimer']>((h) => clearTimeout(h));
  const store = createRoomStore({ emptyRoomTtlMs: TTL, maxObjects, setTimer, clearTimer });
  return { store, setTimer, clearTimer };
}

function add(...objects: BoardObject[]): ClientMessage {
  return { type: 'add', objects };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('rooms: join / roomOf / clientsIn', () => {
  it('新しいルームへの join は空配列を返す', () => {
    const { store } = setup();
    expect(store.join('r1', 'c1')).toEqual([]);
  });

  it('join は現在のオブジェクトを重なり順で返す', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a')));
    store.apply('c1', add(text('b'), stroke('c')));
    const objs = store.join('r1', 'c2');
    expect(objs.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect(objs).toEqual([stroke('a'), text('b'), stroke('c')]);
  });

  it('roomOf は参加中のルームを返し、未参加なら null', () => {
    const { store } = setup();
    expect(store.roomOf('c1')).toBeNull();
    store.join('r1', 'c1');
    expect(store.roomOf('c1')).toBe('r1');
  });

  it('clientsIn は参加者を返す', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.join('r1', 'c2');
    store.join('r2', 'c3');
    expect([...store.clientsIn('r1')].sort()).toEqual(['c1', 'c2']);
    expect(store.clientsIn('r2')).toEqual(['c3']);
  });

  it('ルームごとに状態が独立している', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.join('r2', 'c2');
    store.apply('c1', add(stroke('a')));
    expect(store.snapshot('r1').map((o) => o.id)).toEqual(['a']);
    expect(store.snapshot('r2')).toEqual([]);
  });
});

describe('rooms: apply', () => {
  it('join 前の apply は not-joined', () => {
    const { store } = setup();
    expect(store.apply('c1', add(stroke('a')))).toEqual({ ok: false, reason: 'not-joined' });
    expect(store.apply('c1', { type: 'clear' })).toEqual({ ok: false, reason: 'not-joined' });
  });

  it('add はオブジェクトを末尾に追加する', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    expect(store.apply('c1', add(stroke('a')))).toEqual({ ok: true });
    expect(store.apply('c1', add(text('b')))).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([stroke('a'), text('b')]);
  });

  it('重複 id の add は無視して ok: true', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a')));
    const dup = stroke('a', [[50, 50]], { color: '#ff0000' });
    expect(store.apply('c1', add(dup))).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([stroke('a')]);
  });

  it('update は既存オブジェクトを置き換え、重なり順を保つ', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('a'), stroke('b'), text('c')));
    const updated = text('a', 1, 2, { text: '更新', fontSize: 30 });
    expect(store.apply('c1', { type: 'update', object: updated })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([text('a', 1, 2, { text: '更新', fontSize: 30 }), stroke('b'), text('c')]);
  });

  it('存在しない id への update は無視して ok: true', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('a')));
    expect(store.apply('c1', { type: 'update', object: text('zzz') })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([text('a')]);
  });

  it('move は stroke の全 points と text の x/y を平行移動する', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('s', [[0, 0], [10, 20]]), text('t', 5, 5), stroke('other', [[1, 1]])));
    expect(store.apply('c1', { type: 'move', ids: ['s', 't'], dx: 3, dy: -4 })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([
      stroke('s', [[3, -4], [13, 16]]),
      text('t', 8, 1),
      stroke('other', [[1, 1]]),
    ]);
  });

  it('move は筆圧 p を変えない', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add({ ...stroke('s'), points: [pt(0, 0, 0.2), pt(1, 1, 0.9)] }));
    store.apply('c1', { type: 'move', ids: ['s'], dx: 1, dy: 1 });
    const [s] = store.snapshot('r1');
    expect(s).toEqual({ ...stroke('s'), points: [pt(1, 1, 0.2), pt(2, 2, 0.9)] });
  });

  it('存在しない id への move は無視して ok: true', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('a', 1, 1)));
    expect(store.apply('c1', { type: 'move', ids: ['zzz'], dx: 5, dy: 5 })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([text('a', 1, 1)]);
  });

  it('remove は指定 id を削除し、残りの順序を保つ', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a'), stroke('b'), stroke('c')));
    expect(store.apply('c1', { type: 'remove', ids: ['b'] })).toEqual({ ok: true });
    expect(store.snapshot('r1').map((o) => o.id)).toEqual(['a', 'c']);
  });

  it('存在しない id への remove は無視して ok: true', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a')));
    expect(store.apply('c1', { type: 'remove', ids: ['zzz'] })).toEqual({ ok: true });
    expect(store.snapshot('r1').map((o) => o.id)).toEqual(['a']);
  });

  it('clear は全オブジェクトを削除する', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a'), text('b')));
    expect(store.apply('c1', { type: 'clear' })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([]);
  });

  it('draft 系は状態を変えず ok: true', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a')));
    expect(store.apply('c1', { type: 'draft:start', object: stroke('d') })).toEqual({ ok: true });
    expect(store.apply('c1', { type: 'draft:points', id: 'd', points: [pt(1, 1)] })).toEqual({ ok: true });
    expect(store.apply('c1', { type: 'draft:end', id: 'd' })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([stroke('a')]);
  });
});

describe('rooms: オブジェクト上限', () => {
  it('上限ちょうどまでは追加できる', () => {
    const { store } = setup(3);
    store.join('r1', 'c1');
    expect(store.apply('c1', add(stroke('a'), stroke('b'), stroke('c')))).toEqual({ ok: true });
    expect(store.snapshot('r1')).toHaveLength(3);
  });

  it('上限を超える add は全体を拒否し、状態を変えない', () => {
    const { store } = setup(3);
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a'), stroke('b')));
    expect(store.apply('c1', add(stroke('c'), stroke('d')))).toEqual({ ok: false, reason: 'room-full' });
    expect(store.snapshot('r1').map((o) => o.id)).toEqual(['a', 'b']);
    expect(store.apply('c1', add(stroke('c')))).toEqual({ ok: true });
    expect(store.apply('c1', add(stroke('d')))).toEqual({ ok: false, reason: 'room-full' });
    expect(store.snapshot('r1').map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('rooms: leave と空ルームの破棄', () => {
  it('leave はルームと残り人数を返す', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.join('r1', 'c2');
    expect(store.leave('c1')).toEqual({ roomId: 'r1', remaining: 1 });
    expect(store.roomOf('c1')).toBeNull();
    expect(store.clientsIn('r1')).toEqual(['c2']);
    expect(store.leave('c2')).toEqual({ roomId: 'r1', remaining: 0 });
  });

  it('未参加のクライアントの leave は null', () => {
    const { store } = setup();
    expect(store.leave('nobody')).toBeNull();
  });

  it('leave 後の apply は not-joined', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.join('r1', 'c2');
    store.leave('c1');
    expect(store.apply('c1', add(stroke('a')))).toEqual({ ok: false, reason: 'not-joined' });
  });

  it('まだ人が残っている leave ではタイマーを設定しない', () => {
    const { store, setTimer } = setup();
    store.join('r1', 'c1');
    store.join('r1', 'c2');
    store.leave('c1');
    expect(setTimer).not.toHaveBeenCalled();
  });

  it('最後の1人の leave で TTL タイマーを設定する', () => {
    const { store, setTimer } = setup();
    store.join('r1', 'c1');
    store.leave('c1');
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), TTL);
  });

  it('TTL 前ならルームの内容は残っている', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a')));
    store.leave('c1');
    vi.advanceTimersByTime(TTL - 1);
    expect(store.join('r1', 'c2')).toEqual([stroke('a')]);
  });

  it('TTL が経過するとルームが破棄される', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a')));
    store.leave('c1');
    vi.advanceTimersByTime(TTL);
    expect(store.join('r1', 'c2')).toEqual([]);
  });

  it('TTL 前に誰かが join するとタイマーを取り消し、内容を保持する', () => {
    const { store, setTimer, clearTimer } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(stroke('a')));
    store.leave('c1');
    const handle = setTimer.mock.results[0]?.value;
    vi.advanceTimersByTime(TTL / 2);
    expect(store.join('r1', 'c2')).toEqual([stroke('a')]);
    expect(clearTimer).toHaveBeenCalledWith(handle);
    vi.advanceTimersByTime(TTL * 2);
    expect(store.snapshot('r1')).toEqual([stroke('a')]);
    expect(store.clientsIn('r1')).toEqual(['c2']);
  });
});

describe('rooms: move の座標上限(maxCoordinate)', () => {
  const M = LIMITS.maxCoordinate;
  const invalid = { ok: false, reason: 'invalid-message' };

  it('text を +maxCoordinate+1 へ押し出す move は拒否し、状態は変わらない', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('t', M, 0)));
    expect(store.apply('c1', { type: 'move', ids: ['t'], dx: 1, dy: 0 })).toEqual(invalid);
    expect(store.snapshot('r1')).toEqual([text('t', M, 0)]);
  });

  it('text の y を -maxCoordinate-1 へ押し出す move も拒否', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('t', 0, -M + 5)));
    expect(store.apply('c1', { type: 'move', ids: ['t'], dx: 0, dy: -6 })).toEqual(invalid);
    expect(store.snapshot('r1')).toEqual([text('t', 0, -M + 5)]);
  });

  it('stroke のどれか1点でも上限を超える move は拒否', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    const s = stroke('s', [[0, 0], [M - 10, 0]]);
    store.apply('c1', add(s));
    expect(store.apply('c1', { type: 'move', ids: ['s'], dx: 11, dy: 0 })).toEqual(invalid);
    expect(store.snapshot('r1')).toEqual([stroke('s', [[0, 0], [M - 10, 0]])]);
  });

  it('ちょうど ±maxCoordinate に到達する move は受理', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('t', M - 100, -M + 100), stroke('s', [[0, 0], [M - 1, -M + 1]])));
    expect(store.apply('c1', { type: 'move', ids: ['t'], dx: 100, dy: -100 })).toEqual({ ok: true });
    expect(store.apply('c1', { type: 'move', ids: ['s'], dx: 1, dy: -1 })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([text('t', M, -M), stroke('s', [[1, -1], [M, -M]])]);
  });

  it('複数 id のうち1つでも上限を超えるなら、どれも動かない', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('ok1', 0, 0), text('far', M - 1, 0), stroke('ok2', [[5, 5]])));
    expect(store.apply('c1', { type: 'move', ids: ['ok1', 'far', 'ok2'], dx: 2, dy: 0 })).toEqual(invalid);
    expect(store.snapshot('r1')).toEqual([text('ok1', 0, 0), text('far', M - 1, 0), stroke('ok2', [[5, 5]])]);
  });

  it('存在しない id が混ざっていても、既存オブジェクトが上限を超えるなら拒否', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('far', M, M)));
    expect(store.apply('c1', { type: 'move', ids: ['zzz', 'far'], dx: 0, dy: 1 })).toEqual(invalid);
    expect(store.snapshot('r1')).toEqual([text('far', M, M)]);
  });

  it('存在しない id だけの move は大きな dx でも無視して ok: true', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('a', 1, 1)));
    expect(store.apply('c1', { type: 'move', ids: ['zzz'], dx: 1e12, dy: 0 })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([text('a', 1, 1)]);
  });

  it('繰り返しの move で上限を超える時点の move だけ拒否される(9e6 → +2e6)', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('t', 9_000_000, 0)));
    expect(store.apply('c1', { type: 'move', ids: ['t'], dx: 2_000_000, dy: 0 })).toEqual(invalid);
    expect(store.snapshot('r1')).toEqual([text('t', 9_000_000, 0)]);
    // 範囲内に収まる move はその後も通常どおり動く
    expect(store.apply('c1', { type: 'move', ids: ['t'], dx: 1_000_000, dy: 0 })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([text('t', M, 0)]);
    expect(store.apply('c1', { type: 'move', ids: ['t'], dx: 1, dy: 0 })).toEqual(invalid);
    expect(store.snapshot('r1')).toEqual([text('t', M, 0)]);
    expect(store.apply('c1', { type: 'move', ids: ['t'], dx: -2 * M, dy: 0 })).toEqual({ ok: true });
    expect(store.snapshot('r1')).toEqual([text('t', -M, 0)]);
  });

  it('同じ move を繰り返しても Infinity にならず、上限で止まる', () => {
    const { store } = setup();
    store.join('r1', 'c1');
    store.apply('c1', add(text('t', 0, 0)));
    const results = Array.from({ length: 5 }, () =>
      store.apply('c1', { type: 'move', ids: ['t'], dx: 4_000_000, dy: 0 }),
    );
    expect(results).toEqual([{ ok: true }, { ok: true }, invalid, invalid, invalid]);
    expect(store.snapshot('r1')).toEqual([text('t', 8_000_000, 0)]);
  });
});
