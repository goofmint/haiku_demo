import { describe, it, expect } from 'vitest';
import { createHistory } from '../src/client/history';
import { stroke, text } from './fixtures';

/** 与えた id 集合だけが存在するとみなす exists 関数 */
function existing(...ids: string[]): (id: string) => boolean {
  const set = new Set(ids);
  return (id) => set.has(id);
}

const none = existing();

describe('history: 初期状態', () => {
  it('undo / redo できない', () => {
    const h = createHistory();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo(none)).toBeNull();
    expect(h.redo(none)).toBeNull();
  });
});

describe('history: 逆操作', () => {
  it('add の undo は remove(ids)', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('a'), text('b')] });
    expect(h.canUndo()).toBe(true);
    expect(h.undo(existing('a', 'b'))).toEqual({ type: 'remove', ids: ['a', 'b'] });
  });

  it('remove の undo は add(objects)', () => {
    const h = createHistory();
    h.push({ type: 'remove', objects: [stroke('a'), text('b')] });
    expect(h.undo(none)).toEqual({ type: 'add', objects: [stroke('a'), text('b')] });
  });

  it('move の undo は符号を反転した move', () => {
    const h = createHistory();
    h.push({ type: 'move', ids: ['a', 'b'], dx: 5, dy: -7 });
    expect(h.undo(existing('a', 'b'))).toEqual({ type: 'move', ids: ['a', 'b'], dx: -5, dy: 7 });
  });

  it('update の undo は update(before)', () => {
    const h = createHistory();
    const before = text('t', 0, 0, { text: '前' });
    const after = text('t', 0, 0, { text: '後' });
    h.push({ type: 'update', before, after });
    expect(h.undo(existing('t'))).toEqual({ type: 'update', object: text('t', 0, 0, { text: '前' }) });
  });

  it('undo は新しい順に戻す', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('a')] });
    h.push({ type: 'add', objects: [stroke('b')] });
    expect(h.undo(existing('a', 'b'))).toEqual({ type: 'remove', ids: ['b'] });
    expect(h.undo(existing('a'))).toEqual({ type: 'remove', ids: ['a'] });
    expect(h.undo(none)).toBeNull();
    expect(h.canUndo()).toBe(false);
  });
});

describe('history: redo', () => {
  it('add の redo は add(objects)', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('a')] });
    h.undo(existing('a'));
    expect(h.canRedo()).toBe(true);
    expect(h.redo(none)).toEqual({ type: 'add', objects: [stroke('a')] });
    expect(h.canRedo()).toBe(false);
    expect(h.canUndo()).toBe(true);
  });

  it('remove の redo は remove(ids)', () => {
    const h = createHistory();
    h.push({ type: 'remove', objects: [stroke('a'), stroke('b')] });
    h.undo(none);
    expect(h.redo(existing('a', 'b'))).toEqual({ type: 'remove', ids: ['a', 'b'] });
  });

  it('move の redo は元の move', () => {
    const h = createHistory();
    h.push({ type: 'move', ids: ['a'], dx: 3, dy: 4 });
    h.undo(existing('a'));
    expect(h.redo(existing('a'))).toEqual({ type: 'move', ids: ['a'], dx: 3, dy: 4 });
  });

  it('update の redo は update(after)', () => {
    const h = createHistory();
    h.push({ type: 'update', before: text('t', 0, 0, { text: '前' }), after: text('t', 0, 0, { text: '後' }) });
    h.undo(existing('t'));
    expect(h.redo(existing('t'))).toEqual({ type: 'update', object: text('t', 0, 0, { text: '後' }) });
  });

  it('redo の後に再び undo できる', () => {
    const h = createHistory();
    h.push({ type: 'move', ids: ['a'], dx: 1, dy: 2 });
    h.undo(existing('a'));
    h.redo(existing('a'));
    expect(h.undo(existing('a'))).toEqual({ type: 'move', ids: ['a'], dx: -1, dy: -2 });
  });

  it('push は redo スタックを空にする', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('a')] });
    h.undo(existing('a'));
    expect(h.canRedo()).toBe(true);
    h.push({ type: 'add', objects: [stroke('b')] });
    expect(h.canRedo()).toBe(false);
    expect(h.redo(none)).toBeNull();
  });
});

describe('history: clear', () => {
  it('clear で undo / redo とも空になる', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('a')] });
    h.push({ type: 'add', objects: [stroke('b')] });
    h.undo(existing('a', 'b'));
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.undo(existing('a', 'b'))).toBeNull();
    expect(h.redo(none)).toBeNull();
  });
});

describe('history: 他人に消された対象の除外', () => {
  it('add の undo: 消された id を除いた ids だけ返す', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('a'), stroke('b'), stroke('c')] });
    expect(h.undo(existing('a', 'c'))).toEqual({ type: 'remove', ids: ['a', 'c'] });
  });

  it('add の undo: 全部消されていれば次の履歴の逆操作を返す', () => {
    const h = createHistory();
    h.push({ type: 'move', ids: ['x'], dx: 2, dy: 3 });
    h.push({ type: 'add', objects: [stroke('a'), stroke('b')] });
    expect(h.undo(existing('x'))).toEqual({ type: 'move', ids: ['x'], dx: -2, dy: -3 });
  });

  it('add の undo: 全部消されていて次の履歴も無ければ null', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('a')] });
    expect(h.undo(none)).toBeNull();
  });

  it('remove の undo: 既に存在する id は add から除外する', () => {
    const h = createHistory();
    h.push({ type: 'remove', objects: [stroke('a'), text('b'), stroke('c')] });
    expect(h.undo(existing('b'))).toEqual({ type: 'add', objects: [stroke('a'), stroke('c')] });
  });

  it('remove の undo: 全部既に存在していれば次の履歴へ進む', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('z')] });
    h.push({ type: 'remove', objects: [stroke('a')] });
    expect(h.undo(existing('a', 'z'))).toEqual({ type: 'remove', ids: ['z'] });
  });

  it('move の undo: 消された id を除外する', () => {
    const h = createHistory();
    h.push({ type: 'move', ids: ['a', 'b'], dx: 1, dy: 1 });
    expect(h.undo(existing('b'))).toEqual({ type: 'move', ids: ['b'], dx: -1, dy: -1 });
  });

  it('move の undo: 全部消されていれば次の履歴へ進む', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('z')] });
    h.push({ type: 'move', ids: ['a'], dx: 1, dy: 1 });
    expect(h.undo(existing('z'))).toEqual({ type: 'remove', ids: ['z'] });
  });

  it('update の undo: 対象が消されていれば次の履歴へ進む', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('z')] });
    h.push({ type: 'update', before: text('t', 0, 0, { text: '前' }), after: text('t', 0, 0, { text: '後' }) });
    expect(h.undo(existing('z'))).toEqual({ type: 'remove', ids: ['z'] });
  });

  it('複数の履歴が連続で全部消されていても、残っている最初の履歴まで進む', () => {
    const h = createHistory();
    h.push({ type: 'add', objects: [stroke('keep')] });
    h.push({ type: 'add', objects: [stroke('gone1')] });
    h.push({ type: 'move', ids: ['gone2'], dx: 1, dy: 1 });
    expect(h.undo(existing('keep'))).toEqual({ type: 'remove', ids: ['keep'] });
  });
});
