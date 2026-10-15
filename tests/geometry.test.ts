import { describe, it, expect } from 'vitest';
import {
  distancePointToSegment,
  hitTest,
  rectsIntersect,
  strokeBounds,
  textBounds,
} from '../src/client/geometry';
import type { Rect } from '../src/client/geometry';
import { pt, stroke, text } from './fixtures';

/** 1 文字 = fontSize × 0.5 の幅とみなす計測関数 */
const measure = (line: string, fontSize: number): number => line.length * fontSize * 0.5;

function expectRect(actual: Rect, expected: Rect): void {
  expect(actual.minX).toBeCloseTo(expected.minX);
  expect(actual.minY).toBeCloseTo(expected.minY);
  expect(actual.maxX).toBeCloseTo(expected.maxX);
  expect(actual.maxY).toBeCloseTo(expected.maxY);
}

describe('geometry: distancePointToSegment', () => {
  it('垂線の足が線分上にあるときは垂直距離', () => {
    expect(distancePointToSegment(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
    expect(distancePointToSegment(5, -4, 0, 0, 10, 0)).toBeCloseTo(4);
  });

  it('斜めの線分', () => {
    // 線分 (0,0)-(10,10) と点 (0,10) の距離は 10/√2
    expect(distancePointToSegment(0, 10, 0, 0, 10, 10)).toBeCloseTo(10 / Math.SQRT2);
  });

  it('端点 A より外側なら A までの距離', () => {
    expect(distancePointToSegment(-3, 4, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it('端点 B より外側なら B までの距離', () => {
    expect(distancePointToSegment(13, 4, 0, 0, 10, 0)).toBeCloseTo(5);
  });

  it('線分上の点は 0', () => {
    expect(distancePointToSegment(4, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it('長さ 0 の線分は点までの距離', () => {
    expect(distancePointToSegment(5, 6, 2, 2, 2, 2)).toBeCloseTo(5);
  });
});

describe('geometry: strokeBounds', () => {
  it('全点を囲み、線幅の半分を外側に含む', () => {
    const s = stroke('s', [[0, 0], [10, 5], [-4, 8]], { width: 4 });
    expectRect(strokeBounds(s), { minX: -6, minY: -2, maxX: 12, maxY: 10 });
  });

  it('1 点だけの stroke', () => {
    const s = stroke('s', [[5, 5]], { width: 6 });
    expectRect(strokeBounds(s), { minX: 2, minY: 2, maxX: 8, maxY: 8 });
  });

  it('marker は描画幅(線幅×3)の半分を含む', () => {
    const s = stroke('s', [[0, 0], [10, 5]], { width: 4, style: 'marker' });
    expectRect(strokeBounds(s), { minX: -6, minY: -6, maxX: 16, maxY: 11 });
  });

  it('dashed / dotted は通常の線幅を使う', () => {
    for (const style of ['dashed', 'dotted'] as const) {
      const s = stroke('s', [[0, 0], [10, 5]], { width: 4, style });
      expectRect(strokeBounds(s), { minX: -2, minY: -2, maxX: 12, maxY: 7 });
    }
  });
});

describe('geometry: textBounds', () => {
  it('1 行: 幅は measure の結果、高さは fontSize × 1.3', () => {
    const t = text('t', 100, 50, { text: 'hello', fontSize: 20 });
    expectRect(textBounds(t, measure), { minX: 100, minY: 50, maxX: 150, maxY: 76 });
  });

  it('複数行: 幅は各行の最大、高さは行数 × fontSize × 1.3', () => {
    const t = text('t', 10, 20, { text: 'ab\ncdef\nx', fontSize: 10 });
    // 行幅 10, 20, 5 → 最大 20。高さ 3 × 10 × 1.3 = 39
    expectRect(textBounds(t, measure), { minX: 10, minY: 20, maxX: 30, maxY: 59 });
  });

  it('measure に各行と fontSize を渡す', () => {
    const calls: Array<[string, number]> = [];
    const spy = (line: string, fontSize: number): number => {
      calls.push([line, fontSize]);
      return measure(line, fontSize);
    };
    textBounds(text('t', 0, 0, { text: '一行目\n二行目', fontSize: 16 }), spy);
    expect(calls).toEqual(expect.arrayContaining([['一行目', 16], ['二行目', 16]]));
  });
});

describe('geometry: hitTest', () => {
  it('何にも当たらなければ null', () => {
    const objs = [stroke('a', [[0, 0], [10, 0]]), text('t', 100, 100)];
    expect(hitTest(objs, 500, 500, 0, measure)).toBeNull();
    expect(hitTest([], 0, 0, 10, measure)).toBeNull();
  });

  it('距離 ≤ 線幅/2 + tolerance なら当たり、超えれば外れ', () => {
    const s = stroke('a', [[0, 0], [10, 0]], { width: 4 });
    // 線幅/2 = 2, tolerance = 1 → 3 以内
    expect(hitTest([s], 5, 2.9, 1, measure)?.id).toBe('a');
    expect(hitTest([s], 5, 3.1, 1, measure)).toBeNull();
    // tolerance を広げると当たる
    expect(hitTest([s], 5, 3.1, 2, measure)?.id).toBe('a');
  });

  it('折れ線のいずれかの線分に当たれば当たり', () => {
    const s = stroke('a', [[0, 0], [10, 0], [10, 10]], { width: 2 });
    expect(hitTest([s], 10.5, 8, 0, measure)?.id).toBe('a');
    expect(hitTest([s], 5, 5, 0, measure)).toBeNull();
  });

  it('1 点だけの stroke は点との距離で判定する', () => {
    const s = stroke('a', [[5, 5]], { width: 2 });
    expect(hitTest([s], 5, 5.9, 0, measure)?.id).toBe('a');
    expect(hitTest([s], 5, 6.9, 0, measure)).toBeNull();
  });

  it('marker は線幅×3 の描画幅で判定する', () => {
    const solid = stroke('a', [[0, 0], [10, 0]], { width: 2 });
    const marker = stroke('a', [[0, 0], [10, 0]], { width: 2, style: 'marker' });
    // 距離 2.5: solid(半幅 1)は外れ、marker(半幅 3)は当たり
    expect(hitTest([solid], 5, 2.5, 0, measure)).toBeNull();
    expect(hitTest([marker], 5, 2.5, 0, measure)?.id).toBe('a');
  });

  it('筆圧付き solid も基準線幅で判定する', () => {
    const s = {
      ...stroke('a', [], { width: 10, pressure: true }),
      points: [pt(0, 0, 0.05), pt(10, 0, 0.05)],
    };
    // 基準線幅/2 = 5
    expect(hitTest([s], 5, 4.5, 0, measure)?.id).toBe('a');
  });

  it('テキストは矩形内で当たり', () => {
    // 'hello' fontSize 20 → 幅 50、高さ 26 → (100,100)-(150,126)
    const t = text('t', 100, 100, { text: 'hello', fontSize: 20 });
    expect(hitTest([t], 120, 110, 0, measure)?.id).toBe('t');
    expect(hitTest([t], 300, 300, 0, measure)).toBeNull();
  });

  it('複数行テキストの 2 行目でも当たる', () => {
    // 2 行、fontSize 10 → 高さ 26
    const t = text('t', 0, 0, { text: 'abcd\nabcd', fontSize: 10 });
    expect(hitTest([t], 5, 20, 0, measure)?.id).toBe('t');
  });

  it('重なっている場合は上(配列の後ろ)にあるものを返す', () => {
    const bottom = stroke('bottom', [[0, 0], [10, 0]], { width: 4 });
    const top = stroke('top', [[0, 0], [10, 0]], { width: 4 });
    expect(hitTest([bottom, top], 5, 0, 0, measure)?.id).toBe('top');
    expect(hitTest([top, bottom], 5, 0, 0, measure)?.id).toBe('bottom');
  });

  it('上のオブジェクトに当たらない位置なら下のオブジェクトを返す', () => {
    const bottom = stroke('bottom', [[0, 0], [100, 0]], { width: 4 });
    const top = text('top', 0, -5, { text: 'ab', fontSize: 10 });
    expect(hitTest([bottom, top], 80, 0, 0, measure)?.id).toBe('bottom');
    expect(hitTest([bottom, top], 3, 0, 0, measure)?.id).toBe('top');
  });

  it('当たったオブジェクトの内容を返す', () => {
    const t = text('t', 0, 0);
    expect(hitTest([t], 1, 1, 0, measure)).toEqual(text('t', 0, 0));
  });
});

describe('geometry: rectsIntersect', () => {
  const a: Rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

  it('重なっていれば true', () => {
    expect(rectsIntersect(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true);
  });

  it('包含していれば true(どちら向きでも)', () => {
    const inner: Rect = { minX: 2, minY: 2, maxX: 3, maxY: 3 };
    expect(rectsIntersect(a, inner)).toBe(true);
    expect(rectsIntersect(inner, a)).toBe(true);
  });

  it('辺が接するだけでも true', () => {
    expect(rectsIntersect(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(true);
    expect(rectsIntersect(a, { minX: 0, minY: 10, maxX: 10, maxY: 20 })).toBe(true);
    expect(rectsIntersect(a, { minX: -10, minY: -10, maxX: 0, maxY: 0 })).toBe(true);
  });

  it('離れていれば false', () => {
    expect(rectsIntersect(a, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(false);
    expect(rectsIntersect(a, { minX: 0, minY: -20, maxX: 10, maxY: -0.5 })).toBe(false);
    // x だけ重なり y は離れている
    expect(rectsIntersect(a, { minX: 2, minY: 30, maxX: 8, maxY: 40 })).toBe(false);
  });
});
