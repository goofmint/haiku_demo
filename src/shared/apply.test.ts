import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, type ObjectMap } from './apply.ts';
import type { StrokeObject, TextObject } from './model.ts';

function makeStroke(id: string): StrokeObject {
  return {
    kind: 'stroke',
    id,
    color: '#000000',
    width: 4,
    lineStyle: 'solid',
    pressure: false,
    points: [{ x: 0, y: 0, p: 0.5 }],
  };
}

function makeText(id: string): TextObject {
  return { kind: 'text', id, x: 10, y: 10, text: 'a', color: '#000000', width: 4, lineStyle: 'solid' };
}

test('add stores the object by id', () => {
  const objects: ObjectMap = new Map();
  applyOp(objects, { type: 'add', object: makeStroke('s1') });
  assert.equal(objects.get('s1')?.kind, 'stroke');
});

test('append extends stroke points and ignores unknown ids', () => {
  const objects: ObjectMap = new Map();
  applyOp(objects, { type: 'add', object: makeStroke('s1') });
  applyOp(objects, { type: 'append', id: 's1', points: [{ x: 1, y: 1, p: 0.5 }] });
  applyOp(objects, { type: 'append', id: 'missing', points: [{ x: 2, y: 2, p: 0.5 }] });
  const stroke = objects.get('s1');
  assert.equal(stroke?.kind === 'stroke' && stroke.points.length, 2);
  assert.equal(objects.has('missing'), false);
});

test('move translates strokes and texts additively', () => {
  const objects: ObjectMap = new Map();
  applyOp(objects, { type: 'add', object: makeStroke('s1') });
  applyOp(objects, { type: 'add', object: makeText('t1') });
  applyOp(objects, { type: 'move', ids: ['s1', 't1'], dx: 5, dy: -3 });
  applyOp(objects, { type: 'move', ids: ['t1'], dx: 1, dy: 1 });
  const stroke = objects.get('s1');
  const text = objects.get('t1');
  assert.deepEqual(stroke?.kind === 'stroke' && stroke.points[0], { x: 5, y: -3, p: 0.5 });
  assert.equal(text?.kind === 'text' && text.x, 16);
  assert.equal(text?.kind === 'text' && text.y, 8);
});

test('patch changes only the given fields and text only applies to texts', () => {
  const objects: ObjectMap = new Map();
  applyOp(objects, { type: 'add', object: makeStroke('s1') });
  applyOp(objects, { type: 'add', object: makeText('t1') });
  applyOp(objects, { type: 'patch', id: 's1', changes: { color: '#ff0000', text: 'ignored' } });
  applyOp(objects, { type: 'patch', id: 't1', changes: { text: 'hello', lineStyle: 'dotted' } });
  const stroke = objects.get('s1');
  const text = objects.get('t1');
  assert.equal(stroke?.color, '#ff0000');
  assert.equal(stroke?.kind === 'stroke' && 'text' in stroke, false);
  assert.equal(text?.kind === 'text' && text.text, 'hello');
  assert.equal(text?.lineStyle, 'dotted');
});

test('remove deletes listed ids and clear empties the map', () => {
  const objects: ObjectMap = new Map();
  applyOp(objects, { type: 'add', object: makeStroke('s1') });
  applyOp(objects, { type: 'add', object: makeStroke('s2') });
  applyOp(objects, { type: 'add', object: makeStroke('s3') });
  applyOp(objects, { type: 'remove', ids: ['s1', 's2'] });
  assert.deepEqual([...objects.keys()], ['s3']);
  applyOp(objects, { type: 'clear' });
  assert.equal(objects.size, 0);
});
