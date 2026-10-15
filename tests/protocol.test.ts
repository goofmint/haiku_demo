import { describe, it, expect } from 'vitest';
import { parseClientMessage, parseServerMessage } from '../src/shared/protocol';
import { LIMITS } from '../src/shared/limits';
import { pt, stroke, text } from './fixtures';

/** 値を JSON 化して parseClientMessage に渡す */
function client(value: object): ReturnType<typeof parseClientMessage> {
  return parseClientMessage(JSON.stringify(value));
}

/** 値を JSON 化して parseServerMessage に渡す */
function server(value: object): ReturnType<typeof parseServerMessage> {
  return parseServerMessage(JSON.stringify(value));
}

function addWithStroke(overrides: object): object {
  return { type: 'add', objects: [{ ...stroke('s1'), ...overrides }] };
}

function addWithText(overrides: object): object {
  return { type: 'add', objects: [{ ...text('t1'), ...overrides }] };
}

describe('parseClientMessage: 不正な入力', () => {
  it('JSON として不正な文字列は null', () => {
    expect(parseClientMessage('{not json')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
  });

  it('JSON だがオブジェクトでないものは null', () => {
    expect(parseClientMessage('42')).toBeNull();
    expect(parseClientMessage('null')).toBeNull();
    expect(parseClientMessage('"join"')).toBeNull();
  });

  it('未知の type は null', () => {
    expect(client({ type: 'unknown' })).toBeNull();
  });

  it('サーバー専用メッセージ(init / presence)は null', () => {
    expect(client({ type: 'init', clientId: 'c1', objects: [] })).toBeNull();
    expect(client({ type: 'presence', count: 1 })).toBeNull();
  });
});

describe('parseClientMessage: 各メッセージの受理', () => {
  it('join', () => {
    const msg = { type: 'join', roomId: 'room-1' };
    expect(client(msg)).toEqual(msg);
  });

  it('add(stroke と text)', () => {
    const msg = { type: 'add', objects: [stroke('s1'), text('t1')] };
    expect(client(msg)).toEqual(msg);
  });

  it('update', () => {
    const msg = { type: 'update', object: text('t1', 5, 6, { text: '日本語\n2行目' }) };
    expect(client(msg)).toEqual(msg);
  });

  it('move', () => {
    const msg = { type: 'move', ids: ['a', 'b'], dx: 10, dy: -3.5 };
    expect(client(msg)).toEqual(msg);
  });

  it('remove', () => {
    const msg = { type: 'remove', ids: ['a'] };
    expect(client(msg)).toEqual(msg);
  });

  it('clear', () => {
    const msg = { type: 'clear' };
    expect(client(msg)).toEqual(msg);
  });

  it('draft:start', () => {
    const msg = { type: 'draft:start', object: stroke('d1') };
    expect(client(msg)).toEqual(msg);
  });

  it('draft:points', () => {
    const msg = { type: 'draft:points', id: 'd1', points: [pt(1, 2), pt(3, 4, 1)] };
    expect(client(msg)).toEqual(msg);
  });

  it('draft:end', () => {
    const msg = { type: 'draft:end', id: 'd1' };
    expect(client(msg)).toEqual(msg);
  });

  it('全スタイルの stroke を受理する', () => {
    for (const style of ['solid', 'dashed', 'dotted', 'marker']) {
      expect(client(addWithStroke({ style }))).not.toBeNull();
    }
  });

  it('未知の style は拒否する', () => {
    expect(client(addWithStroke({ style: 'wavy' }))).toBeNull();
  });
});

describe('parseClientMessage: color', () => {
  it('#rrggbb(大文字小文字混在)は受理', () => {
    expect(client(addWithStroke({ color: '#aAbB09' }))).not.toBeNull();
    expect(client(addWithText({ color: '#FFFFFF' }))).not.toBeNull();
  });

  it('形式違いは拒否', () => {
    for (const color of ['#fff', 'red', '#GGGGGG', '#1234567', '123456', 'rgb(0,0,0)', '']) {
      expect(client(addWithStroke({ color }))).toBeNull();
      expect(client(addWithText({ color }))).toBeNull();
    }
  });
});

describe('parseClientMessage: width', () => {
  it('0 は拒否', () => {
    expect(client(addWithStroke({ width: 0 }))).toBeNull();
  });

  it('負の値は拒否', () => {
    expect(client(addWithStroke({ width: -1 }))).toBeNull();
  });

  it('0 より大きい小さな値は受理', () => {
    expect(client(addWithStroke({ width: 0.5 }))).not.toBeNull();
  });

  it('200 は受理', () => {
    expect(client(addWithStroke({ width: 200 }))).not.toBeNull();
  });

  it('200 を超えると拒否', () => {
    expect(client(addWithStroke({ width: 200.5 }))).toBeNull();
    expect(client(addWithStroke({ width: 201 }))).toBeNull();
  });

  it('draft:start の object にも同じ規則を適用する', () => {
    expect(client({ type: 'draft:start', object: { ...stroke('d1'), width: 0 } })).toBeNull();
  });
});

describe('parseClientMessage: fontSize', () => {
  it('4 と 400 は受理', () => {
    expect(client(addWithText({ fontSize: 4 }))).not.toBeNull();
    expect(client(addWithText({ fontSize: 400 }))).not.toBeNull();
  });

  it('3 と 401 は拒否', () => {
    expect(client(addWithText({ fontSize: 3 }))).toBeNull();
    expect(client(addWithText({ fontSize: 401 }))).toBeNull();
  });
});

describe('parseClientMessage: pressure (p)', () => {
  it('0 と 1 は受理', () => {
    expect(client({ type: 'draft:points', id: 'd', points: [pt(0, 0, 0), pt(1, 1, 1)] })).not.toBeNull();
  });

  it('0 未満・1 超は拒否', () => {
    expect(client({ type: 'draft:points', id: 'd', points: [pt(0, 0, -0.01)] })).toBeNull();
    expect(client({ type: 'draft:points', id: 'd', points: [pt(0, 0, 1.01)] })).toBeNull();
    expect(client(addWithStroke({ points: [pt(0, 0, 2)] }))).toBeNull();
  });
});

describe('parseClientMessage: points', () => {
  it('空の points は拒否(stroke / draft:points)', () => {
    expect(client(addWithStroke({ points: [] }))).toBeNull();
    expect(client({ type: 'draft:points', id: 'd', points: [] })).toBeNull();
  });

  it('1 点だけの stroke は受理', () => {
    expect(client(addWithStroke({ points: [pt(1, 1)] }))).not.toBeNull();
  });

  it('maxPointsPerStroke ちょうどは受理', () => {
    const points = Array.from({ length: LIMITS.maxPointsPerStroke }, (_, i) => pt(i, i));
    expect(client(addWithStroke({ points }))).not.toBeNull();
    expect(client({ type: 'draft:points', id: 'd', points })).not.toBeNull();
  });

  it('maxPointsPerStroke を超えると拒否', () => {
    const points = Array.from({ length: LIMITS.maxPointsPerStroke + 1 }, (_, i) => pt(i, i));
    expect(client(addWithStroke({ points }))).toBeNull();
    expect(client({ type: 'draft:points', id: 'd', points })).toBeNull();
  });
});

describe('parseClientMessage: text', () => {
  it('maxTextLength ちょうどは受理', () => {
    expect(client(addWithText({ text: 'a'.repeat(LIMITS.maxTextLength) }))).not.toBeNull();
  });

  it('maxTextLength を超えると拒否', () => {
    expect(client(addWithText({ text: 'a'.repeat(LIMITS.maxTextLength + 1) }))).toBeNull();
    expect(
      client({ type: 'update', object: { ...text('t1'), text: 'a'.repeat(LIMITS.maxTextLength + 1) } }),
    ).toBeNull();
  });
});

describe('parseClientMessage: ids / id', () => {
  it('空の ids 配列は拒否(move / remove)', () => {
    expect(client({ type: 'move', ids: [], dx: 1, dy: 1 })).toBeNull();
    expect(client({ type: 'remove', ids: [] })).toBeNull();
  });

  it('空文字列の id は拒否', () => {
    expect(client({ type: 'remove', ids: [''] })).toBeNull();
    expect(client({ type: 'draft:end', id: '' })).toBeNull();
    expect(client(addWithStroke({ id: '' }))).toBeNull();
  });

  it('maxIdLength を超える id は拒否、ちょうどは受理', () => {
    expect(client({ type: 'draft:end', id: 'a'.repeat(LIMITS.maxIdLength) })).not.toBeNull();
    expect(client({ type: 'draft:end', id: 'a'.repeat(LIMITS.maxIdLength + 1) })).toBeNull();
  });
});

describe('parseClientMessage: 数値は有限値のみ', () => {
  it('JSON の 1e400(Infinity になる)は拒否', () => {
    expect(parseClientMessage('{"type":"move","ids":["a"],"dx":1e400,"dy":0}')).toBeNull();
  });

  it('数値の代わりの文字列は拒否', () => {
    expect(client({ type: 'move', ids: ['a'], dx: '1', dy: 0 })).toBeNull();
  });
});

describe('parseClientMessage: roomId', () => {
  it('英数字・_・- の 1〜64 文字は受理', () => {
    for (const roomId of ['a', 'Ab_-9', 'x'.repeat(64)]) {
      expect(client({ type: 'join', roomId })).toEqual({ type: 'join', roomId });
    }
  });

  it('65 文字は拒否', () => {
    expect(client({ type: 'join', roomId: 'x'.repeat(65) })).toBeNull();
  });

  it('空文字・不正文字は拒否', () => {
    for (const roomId of ['', 'a b', 'a/b', 'a.b', 'ルーム', 'a?b']) {
      expect(client({ type: 'join', roomId })).toBeNull();
    }
  });
});

describe('parseServerMessage', () => {
  it('JSON として不正な文字列は null', () => {
    expect(parseServerMessage('{oops')).toBeNull();
  });

  it('init(空の objects を含む)', () => {
    const empty = { type: 'init', clientId: 'c1', objects: [] };
    expect(server(empty)).toEqual(empty);
    const filled = { type: 'init', clientId: 'c1', objects: [stroke('s1'), text('t1')] };
    expect(server(filled)).toEqual(filled);
  });

  it('presence', () => {
    const msg = { type: 'presence', count: 3 };
    expect(server(msg)).toEqual(msg);
  });

  it('add / update / move / remove / clear', () => {
    const msgs = [
      { type: 'add', objects: [stroke('s1')] },
      { type: 'update', object: text('t1') },
      { type: 'move', ids: ['s1'], dx: 1, dy: 2 },
      { type: 'remove', ids: ['s1'] },
      { type: 'clear' },
    ];
    for (const msg of msgs) {
      expect(server(msg)).toEqual(msg);
    }
  });

  it('draft 系は clientId 付きで受理', () => {
    const msgs = [
      { type: 'draft:start', clientId: 'c1', object: stroke('d1') },
      { type: 'draft:points', clientId: 'c1', id: 'd1', points: [pt(1, 1)] },
      { type: 'draft:end', clientId: 'c1', id: 'd1' },
    ];
    for (const msg of msgs) {
      expect(server(msg)).toEqual(msg);
    }
  });

  it('draft 系は clientId が無いと拒否', () => {
    expect(server({ type: 'draft:start', object: stroke('d1') })).toBeNull();
    expect(server({ type: 'draft:points', id: 'd1', points: [pt(1, 1)] })).toBeNull();
    expect(server({ type: 'draft:end', id: 'd1' })).toBeNull();
  });

  it('draft 系の clientId が空文字なら拒否', () => {
    expect(server({ type: 'draft:end', clientId: '', id: 'd1' })).toBeNull();
  });

  it('drafts:drop', () => {
    const msg = { type: 'drafts:drop', clientId: 'c1' };
    expect(server(msg)).toEqual(msg);
    expect(server({ type: 'drafts:drop' })).toBeNull();
  });

  it('error', () => {
    const msg = { type: 'error', message: 'invalid-message' };
    expect(server(msg)).toEqual(msg);
  });

  it('クライアント専用の join は拒否', () => {
    expect(server({ type: 'join', roomId: 'r' })).toBeNull();
  });

  it('サーバー側の add にも同じ検証規則を適用する', () => {
    expect(server({ type: 'add', objects: [{ ...stroke('s1'), width: 0 }] })).toBeNull();
    expect(server({ type: 'add', objects: [{ ...text('t1'), color: '#fff' }] })).toBeNull();
  });
});

describe('parseClientMessage / parseServerMessage: 座標の上限(maxCoordinate)', () => {
  const M = LIMITS.maxCoordinate;

  it('maxCoordinate は 10,000,000', () => {
    expect(M).toBe(10_000_000);
  });

  it('stroke の点 x,y はちょうど ±maxCoordinate なら受理', () => {
    const points = [pt(M, M), pt(-M, -M), pt(M, -M), pt(-M, M)];
    const msg = addWithStroke({ points });
    expect(client(msg)).toEqual(msg);
    expect(client({ type: 'draft:points', id: 'd', points })).not.toBeNull();
    expect(client({ type: 'draft:start', object: { ...stroke('d'), points } })).not.toBeNull();
    expect(client({ type: 'update', object: { ...stroke('s1'), points } })).not.toBeNull();
  });

  it('stroke の点 x がわずかでも maxCoordinate を超えると拒否', () => {
    for (const x of [M + 1, -(M + 1), M + 0.5]) {
      expect(client(addWithStroke({ points: [pt(0, 0), pt(x, 0)] }))).toBeNull();
      expect(client({ type: 'draft:points', id: 'd', points: [pt(x, 0)] })).toBeNull();
      expect(client({ type: 'draft:start', object: { ...stroke('d'), points: [pt(x, 0)] } })).toBeNull();
      expect(client({ type: 'update', object: { ...stroke('s1'), points: [pt(x, 0)] } })).toBeNull();
    }
  });

  it('stroke の点 y がわずかでも maxCoordinate を超えると拒否', () => {
    for (const y of [M + 1, -(M + 1)]) {
      expect(client(addWithStroke({ points: [pt(0, y)] }))).toBeNull();
      expect(client({ type: 'draft:points', id: 'd', points: [pt(0, y)] })).toBeNull();
    }
  });

  it('text の x,y はちょうど ±maxCoordinate なら受理', () => {
    for (const [x, y] of [
      [M, M],
      [-M, -M],
      [M, -M],
      [-M, M],
    ] as const) {
      const msg = addWithText({ x, y });
      expect(client(msg)).toEqual(msg);
      expect(client({ type: 'update', object: text('t1', x, y) })).not.toBeNull();
    }
  });

  it('text の x,y が maxCoordinate を超えると拒否', () => {
    for (const [x, y] of [
      [M + 1, 0],
      [-(M + 1), 0],
      [0, M + 1],
      [0, -(M + 1)],
    ] as const) {
      expect(client(addWithText({ x, y }))).toBeNull();
      expect(client({ type: 'update', object: text('t1', x, y) })).toBeNull();
    }
  });

  it('parseServerMessage でも同じ境界(add / update / init / draft)', () => {
    expect(server(addWithText({ x: M, y: -M }))).not.toBeNull();
    expect(server(addWithText({ x: M + 1, y: 0 }))).toBeNull();
    expect(server({ type: 'update', object: text('t1', 0, -(M + 1)) })).toBeNull();
    expect(server(addWithStroke({ points: [pt(-M, M)] }))).not.toBeNull();
    expect(server(addWithStroke({ points: [pt(-(M + 1), 0)] }))).toBeNull();
    expect(server({ type: 'init', clientId: 'c1', objects: [text('t1', M, M)] })).not.toBeNull();
    expect(server({ type: 'init', clientId: 'c1', objects: [text('t1', M + 1, 0)] })).toBeNull();
    expect(server({ type: 'init', clientId: 'c1', objects: [stroke('s1', [[0, M + 1]])] })).toBeNull();
    expect(
      server({ type: 'draft:points', clientId: 'c1', id: 'd', points: [pt(M, M)] }),
    ).not.toBeNull();
    expect(server({ type: 'draft:points', clientId: 'c1', id: 'd', points: [pt(M + 1, 0)] })).toBeNull();
  });
});
