import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundsIntersect, hitTest, objectBounds, rectFromPoints, unionBounds } from './geometry.ts';
import type { StrokeObject, TextObject } from '../shared/model.ts';

// Fixed-width stub: every character is 10px wide.
const measure = (line: string) => line.length * 10;

const stroke: StrokeObject = {
  kind: 'stroke',
  id: 's',
  color: '#000',
  width: 4,
  lineStyle: 'solid',
  pressure: false,
  points: [
    { x: 0, y: 0, p: 0.5 },
    { x: 100, y: 0, p: 0.5 },
  ],
};

const text: TextObject = {
  kind: 'text',
  id: 't',
  x: 50,
  y: 50,
  text: 'abc',
  color: '#000',
  width: 4,
  lineStyle: 'solid',
};

test('stroke bounds include half the line width', () => {
  assert.deepEqual(objectBounds(stroke, measure), { minX: -2, minY: -2, maxX: 102, maxY: 2 });
});

test('text bounds use measured width and line count', () => {
  const bounds = objectBounds({ ...text, text: 'ab\ncdef' }, measure);
  assert.equal(bounds.minX, 50);
  assert.equal(bounds.maxX, 50 + 40);
  assert.ok(bounds.maxY > bounds.minY + 2 * 16);
});

test('hit test follows the stroke segment, not just its endpoints', () => {
  assert.equal(hitTest(stroke, 50, 3, measure), true);
  assert.equal(hitTest(stroke, 50, 20, measure), false);
  assert.equal(hitTest(stroke, 0, 0, measure), true);
});

test('hit test for text uses its rectangle', () => {
  assert.equal(hitTest(text, 55, 55, measure), true);
  assert.equal(hitTest(text, 0, 0, measure), false);
});

test('union, rectangle normalisation and intersection', () => {
  const rect = rectFromPoints(120, 10, 60, -5);
  assert.deepEqual(rect, { minX: 60, minY: -5, maxX: 120, maxY: 10 });
  assert.equal(boundsIntersect(objectBounds(stroke, measure), rect), true);
  assert.equal(boundsIntersect(objectBounds(text, measure), { minX: 0, minY: 0, maxX: 10, maxY: 10 }), false);
  assert.deepEqual(unionBounds([]), null);
});
