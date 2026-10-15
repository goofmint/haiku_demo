import { z } from 'zod';
import { LIMITS } from './limits';
import type { BoardObject, Point, StrokeObject, TextObject } from './types';

// ---------------------------------------------------------------------------
// 共通スキーマ
// ---------------------------------------------------------------------------

const idSchema = z.string().min(1).max(LIMITS.maxIdLength);

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const roomIdSchema = z.string().regex(LIMITS.roomIdPattern);

/** z.number() は v4 で NaN / Infinity を受け付けないため、有限値のみになる */
const finiteNumberSchema = z.number();

/** ワールド座標。絶対値は LIMITS.maxCoordinate 以下 */
const coordinateSchema = z.number().min(-LIMITS.maxCoordinate).max(LIMITS.maxCoordinate);

export const pointSchema = z.object({
  x: coordinateSchema,
  y: coordinateSchema,
  p: z.number().min(LIMITS.minPressure).max(LIMITS.maxPressure),
});

const pointsSchema = z.array(pointSchema).min(1).max(LIMITS.maxPointsPerStroke);

const strokeStyleSchema = z.enum(['solid', 'dashed', 'dotted', 'marker']);

const strokeObjectSchema = z.object({
  id: idSchema,
  kind: z.literal('stroke'),
  points: pointsSchema,
  color: colorSchema,
  width: z.number().positive().max(LIMITS.maxStrokeWidth),
  style: strokeStyleSchema,
  pressure: z.boolean(),
});

const textObjectSchema = z.object({
  id: idSchema,
  kind: z.literal('text'),
  x: coordinateSchema,
  y: coordinateSchema,
  text: z.string().max(LIMITS.maxTextLength),
  color: colorSchema,
  fontSize: z.number().min(LIMITS.minFontSize).max(LIMITS.maxFontSize),
});

export const boardObjectSchema = z.discriminatedUnion('kind', [strokeObjectSchema, textObjectSchema]);

const objectsSchema = z.array(boardObjectSchema).min(1).max(LIMITS.maxObjectsPerRoom);

const idsSchema = z.array(idSchema).min(1);

// ---------------------------------------------------------------------------
// 双方向で共通のボード操作メッセージ
// ---------------------------------------------------------------------------

const addMessageSchema = z.object({
  type: z.literal('add'),
  objects: objectsSchema,
});

const updateMessageSchema = z.object({
  type: z.literal('update'),
  object: boardObjectSchema,
});

const moveMessageSchema = z.object({
  type: z.literal('move'),
  ids: idsSchema,
  dx: finiteNumberSchema,
  dy: finiteNumberSchema,
});

const removeMessageSchema = z.object({
  type: z.literal('remove'),
  ids: idsSchema,
});

const clearMessageSchema = z.object({
  type: z.literal('clear'),
});

// ---------------------------------------------------------------------------
// クライアント → サーバー
// ---------------------------------------------------------------------------

const joinMessageSchema = z.object({
  type: z.literal('join'),
  roomId: roomIdSchema,
});

const clientDraftStartSchema = z.object({
  type: z.literal('draft:start'),
  object: strokeObjectSchema,
});

const clientDraftPointsSchema = z.object({
  type: z.literal('draft:points'),
  id: idSchema,
  points: pointsSchema,
});

const clientDraftEndSchema = z.object({
  type: z.literal('draft:end'),
  id: idSchema,
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  joinMessageSchema,
  addMessageSchema,
  updateMessageSchema,
  moveMessageSchema,
  removeMessageSchema,
  clearMessageSchema,
  clientDraftStartSchema,
  clientDraftPointsSchema,
  clientDraftEndSchema,
]);

// ---------------------------------------------------------------------------
// サーバー → クライアント
// ---------------------------------------------------------------------------

const initMessageSchema = z.object({
  type: z.literal('init'),
  clientId: idSchema,
  objects: z.array(boardObjectSchema).max(LIMITS.maxObjectsPerRoom),
});

const presenceMessageSchema = z.object({
  type: z.literal('presence'),
  count: z.int().min(0),
});

const serverDraftStartSchema = clientDraftStartSchema.extend({ clientId: idSchema });
const serverDraftPointsSchema = clientDraftPointsSchema.extend({ clientId: idSchema });
const serverDraftEndSchema = clientDraftEndSchema.extend({ clientId: idSchema });

const draftsDropMessageSchema = z.object({
  type: z.literal('drafts:drop'),
  clientId: idSchema,
});

const errorMessageSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  initMessageSchema,
  presenceMessageSchema,
  addMessageSchema,
  updateMessageSchema,
  moveMessageSchema,
  removeMessageSchema,
  clearMessageSchema,
  serverDraftStartSchema,
  serverDraftPointsSchema,
  serverDraftEndSchema,
  draftsDropMessageSchema,
  errorMessageSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// ---------------------------------------------------------------------------
// パース
// ---------------------------------------------------------------------------

/** 文字列を受け取り、JSON として不正またはスキーマ不一致なら null を返す */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const result = clientMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** 文字列を受け取り、JSON として不正またはスキーマ不一致なら null を返す */
export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const result = serverMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// コンパイル時の型整合チェック(スキーマの推論型と types.ts の型が一致すること)
// ---------------------------------------------------------------------------

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

/** 型チェック専用。値としては使わない */
export type ProtocolTypeConformance = [
  Assert<Equals<z.infer<typeof pointSchema>, Point>>,
  Assert<Equals<z.infer<typeof strokeObjectSchema>, StrokeObject>>,
  Assert<Equals<z.infer<typeof textObjectSchema>, TextObject>>,
  Assert<Equals<z.infer<typeof boardObjectSchema>, BoardObject>>,
];
