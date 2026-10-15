import { describe, it, expect } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, panBy, screenToWorld, worldToScreen, zoomAt } from '../src/client/camera';
import type { Camera } from '../src/client/camera';

const cam: Camera = { x: 10, y: -20, zoom: 2 };

describe('camera: 定数', () => {
  it('ズーム範囲は 0.1〜8', () => {
    expect(MIN_ZOOM).toBe(0.1);
    expect(MAX_ZOOM).toBe(8);
  });
});

describe('camera: 座標変換', () => {
  it('worldToScreen は screen = (world - {x,y}) * zoom', () => {
    const s = worldToScreen(cam, 15, 5);
    expect(s.x).toBeCloseTo((15 - 10) * 2);
    expect(s.y).toBeCloseTo((5 + 20) * 2);
  });

  it('screenToWorld は worldToScreen の逆変換', () => {
    const w = screenToWorld(cam, 10, 50);
    expect(w.x).toBeCloseTo(15);
    expect(w.y).toBeCloseTo(5);
  });

  it('往復で元の座標に戻る(ズーム 1 以外・小数)', () => {
    const c: Camera = { x: -123.4, y: 56.7, zoom: 0.37 };
    for (const [wx, wy] of [
      [0, 0],
      [1000.5, -333.25],
      [-7, 42],
    ] as const) {
      const s = worldToScreen(c, wx, wy);
      const w = screenToWorld(c, s.x, s.y);
      expect(w.x).toBeCloseTo(wx);
      expect(w.y).toBeCloseTo(wy);
    }
  });
});

describe('camera: zoomAt', () => {
  it('ズーム倍率を factor 倍する', () => {
    expect(zoomAt(cam, 100, 50, 2).zoom).toBeCloseTo(4);
    expect(zoomAt(cam, 100, 50, 0.5).zoom).toBeCloseTo(1);
  });

  it('指定した画面上の点のワールド座標が変わらない', () => {
    const sx = 123;
    const sy = -45;
    const before = screenToWorld(cam, sx, sy);
    for (const factor of [1.5, 0.6, 3]) {
      const next = zoomAt(cam, sx, sy, factor);
      const after = screenToWorld(next, sx, sy);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
    }
  });

  it('MAX_ZOOM を超えないよう clamp する', () => {
    expect(zoomAt(cam, 0, 0, 1000).zoom).toBeCloseTo(MAX_ZOOM);
  });

  it('MIN_ZOOM を下回らないよう clamp する', () => {
    expect(zoomAt(cam, 0, 0, 0.0001).zoom).toBeCloseTo(MIN_ZOOM);
  });
});

describe('camera: panBy', () => {
  it('固定したワールド点の画面座標が (dsx, dsy) だけ動く', () => {
    const wx = 37;
    const wy = -12;
    const before = worldToScreen(cam, wx, wy);
    const next = panBy(cam, 30, -40);
    const after = worldToScreen(next, wx, wy);
    expect(after.x - before.x).toBeCloseTo(30);
    expect(after.y - before.y).toBeCloseTo(-40);
  });

  it('ズーム倍率は変えない', () => {
    expect(panBy(cam, 30, -40).zoom).toBe(cam.zoom);
  });
});
