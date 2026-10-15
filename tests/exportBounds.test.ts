import { describe, it, expect } from 'vitest';
import { exportBounds, exportScale } from '../src/client/geometry';
import type { Rect } from '../src/client/geometry';

function rect(minX: number, minY: number, maxX: number, maxY: number): Rect {
  return { minX, minY, maxX, maxY };
}

describe('geometry: exportBounds', () => {
  it('空配列なら null', () => {
    expect(exportBounds([], 32)).toBeNull();
  });

  it('1 つの矩形に余白を足す', () => {
    const b = exportBounds([rect(0, 0, 100, 50)], 32);
    expect(b).not.toBeNull();
    expect(b).toEqual(rect(-32, -32, 132, 82));
  });

  it('複数の矩形の和集合に余白を足す', () => {
    const b = exportBounds([rect(0, 0, 10, 10), rect(-5, 20, 3, 30), rect(40, -8, 45, 2)], 32);
    expect(b).toEqual(rect(-37, -40, 77, 62));
  });

  it('余白 0 なら和集合そのもの', () => {
    expect(exportBounds([rect(1, 2, 3, 4), rect(5, 6, 7, 8)], 0)).toEqual(rect(1, 2, 7, 8));
  });
});

describe('geometry: exportScale', () => {
  it('倍率をかけても maxSide 以下なら preferredScale を返す', () => {
    expect(exportScale(rect(0, 0, 100, 50), 2, 8192)).toBe(2);
  });

  it('ちょうど maxSide になる場合も preferredScale を返す', () => {
    expect(exportScale(rect(0, 0, 4096, 100), 2, 8192)).toBe(2);
  });

  it('幅が maxSide を超える場合は倍率を下げ、一辺が maxSide 以下になる', () => {
    const bounds = rect(0, 0, 10_000, 500);
    const scale = exportScale(bounds, 2, 8192);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(2);
    expect(10_000 * scale).toBeLessThanOrEqual(8192 + 1e-6);
  });

  it('高さが maxSide を超える場合も倍率を下げる', () => {
    const bounds = rect(-100, -3000, 100, 3000);
    const scale = exportScale(bounds, 2, 8192);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(2);
    expect(6000 * scale).toBeLessThanOrEqual(8192 + 1e-6);
  });
});
