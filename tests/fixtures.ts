import type { Point, StrokeObject, TextObject } from '../src/shared/types';

/** テスト用の点を作る */
export function pt(x: number, y: number, p = 0.5): Point {
  return { x, y, p };
}

type StrokeOverrides = Partial<Omit<StrokeObject, 'id' | 'kind' | 'points'>>;
type TextOverrides = Partial<Omit<TextObject, 'id' | 'kind' | 'x' | 'y'>>;

/** テスト用の線オブジェクトを作る(呼ぶたびに新しいオブジェクトを返す) */
export function stroke(
  id: string,
  coords: ReadonlyArray<readonly [number, number]> = [
    [0, 0],
    [10, 10],
  ],
  overrides: StrokeOverrides = {},
): StrokeObject {
  return {
    id,
    kind: 'stroke',
    points: coords.map(([x, y]) => pt(x, y)),
    color: '#112233',
    width: 4,
    style: 'solid',
    pressure: false,
    ...overrides,
  };
}

/** テスト用のテキストオブジェクトを作る(呼ぶたびに新しいオブジェクトを返す) */
export function text(id: string, x = 0, y = 0, overrides: TextOverrides = {}): TextObject {
  return {
    id,
    kind: 'text',
    x,
    y,
    text: 'hello',
    color: '#000000',
    fontSize: 20,
    ...overrides,
  };
}
