import { describe, it, expect, vi } from 'vitest';
import { createBoard } from '../src/client/board';
import { pt, stroke, text } from './fixtures';

describe('board: list / get', () => {
  it('初期状態は空', () => {
    const board = createBoard();
    expect(board.list()).toEqual([]);
    expect(board.get('a')).toBeUndefined();
  });

  it('add した順(下→上)で list が返る', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [stroke('a'), text('b')] });
    board.apply({ type: 'add', objects: [stroke('c')] });
    expect(board.list()).toEqual([stroke('a'), text('b'), stroke('c')]);
  });

  it('get は id でオブジェクトを返す', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [stroke('a'), text('b', 3, 4)] });
    expect(board.get('b')).toEqual(text('b', 3, 4));
    expect(board.get('zzz')).toBeUndefined();
  });
});

describe('board: apply', () => {
  it('重複 id の add は無視する', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [stroke('a')] });
    board.apply({ type: 'add', objects: [stroke('a', [[99, 99]], { color: '#ff0000' })] });
    expect(board.list()).toEqual([stroke('a')]);
  });

  it('update は置き換え、重なり順を保つ', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [text('a'), stroke('b'), text('c')] });
    board.apply({ type: 'update', object: text('a', 7, 8, { text: '再編集' }) });
    expect(board.list()).toEqual([text('a', 7, 8, { text: '再編集' }), stroke('b'), text('c')]);
    expect(board.get('a')).toEqual(text('a', 7, 8, { text: '再編集' }));
  });

  it('存在しない id への update は無視する(追加もしない)', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [text('a')] });
    board.apply({ type: 'update', object: text('zzz') });
    expect(board.list()).toEqual([text('a')]);
    expect(board.get('zzz')).toBeUndefined();
  });

  it('move は stroke の全 points と text の x/y を平行移動する', () => {
    const board = createBoard();
    board.apply({
      type: 'add',
      objects: [stroke('s', [[0, 0], [10, 20]]), text('t', 5, 5), text('u', 0, 0)],
    });
    board.apply({ type: 'move', ids: ['s', 't'], dx: -2, dy: 6 });
    expect(board.list()).toEqual([stroke('s', [[-2, 6], [8, 26]]), text('t', 3, 11), text('u', 0, 0)]);
  });

  it('move は筆圧 p を変えない', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [{ ...stroke('s'), points: [pt(0, 0, 0.1), pt(2, 2, 0.7)] }] });
    board.apply({ type: 'move', ids: ['s'], dx: 1, dy: 2 });
    expect(board.get('s')).toEqual({ ...stroke('s'), points: [pt(1, 2, 0.1), pt(3, 4, 0.7)] });
  });

  it('存在しない id への move は無視する', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [text('a', 1, 1)] });
    board.apply({ type: 'move', ids: ['zzz'], dx: 5, dy: 5 });
    expect(board.list()).toEqual([text('a', 1, 1)]);
  });

  it('remove は指定 id を削除し、残りの順序を保つ', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [stroke('a'), stroke('b'), stroke('c')] });
    board.apply({ type: 'remove', ids: ['a', 'c'] });
    expect(board.list().map((o) => o.id)).toEqual(['b']);
    expect(board.get('a')).toBeUndefined();
  });

  it('存在しない id への remove は無視する', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [stroke('a')] });
    board.apply({ type: 'remove', ids: ['zzz'] });
    expect(board.list()).toEqual([stroke('a')]);
  });

  it('clear は全削除する', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [stroke('a'), text('b')] });
    board.apply({ type: 'clear' });
    expect(board.list()).toEqual([]);
  });

  it('remove 後に同じ id を add すると末尾に入る', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [stroke('a'), stroke('b')] });
    board.apply({ type: 'remove', ids: ['a'] });
    board.apply({ type: 'add', objects: [stroke('a')] });
    expect(board.list().map((o) => o.id)).toEqual(['b', 'a']);
  });
});

describe('board: reset', () => {
  it('reset は内容を与えた配列(順序どおり)で置き換える', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [stroke('old')] });
    board.reset([text('x'), stroke('y')]);
    expect(board.list()).toEqual([text('x'), stroke('y')]);
    expect(board.get('old')).toBeUndefined();
  });

  it('reset([]) で空になる', () => {
    const board = createBoard();
    board.apply({ type: 'add', objects: [stroke('a')] });
    board.reset([]);
    expect(board.list()).toEqual([]);
  });
});

describe('board: subscribe', () => {
  it('変更があると購読者が呼ばれる', () => {
    const board = createBoard();
    const fn = vi.fn();
    board.subscribe(fn);
    board.apply({ type: 'add', objects: [stroke('a')] });
    expect(fn).toHaveBeenCalled();
  });

  it('reset でも購読者が呼ばれる', () => {
    const board = createBoard();
    const fn = vi.fn();
    board.subscribe(fn);
    board.reset([stroke('a')]);
    expect(fn).toHaveBeenCalled();
  });

  it('解除関数を呼ぶと以後は呼ばれない', () => {
    const board = createBoard();
    const fn = vi.fn();
    const unsubscribe = board.subscribe(fn);
    unsubscribe();
    board.apply({ type: 'add', objects: [stroke('a')] });
    board.reset([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('複数の購読者がそれぞれ呼ばれ、片方の解除は他方に影響しない', () => {
    const board = createBoard();
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = board.subscribe(a);
    board.subscribe(b);
    unsubA();
    board.apply({ type: 'add', objects: [stroke('x')] });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });
});
