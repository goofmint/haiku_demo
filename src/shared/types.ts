export type Point = { x: number; y: number; p: number }; // p = 筆圧 0..1（非対応時 0.5）
export type LineStyle = 'solid' | 'dashed' | 'dotted';

export type StrokeObject = {
  id: string;
  kind: 'stroke';
  points: Point[];
  color: string;      // '#rrggbb'
  width: number;      // 基本線幅(px)。筆圧で 0.5x〜1.5x に変化
  lineStyle: LineStyle;
};

export type TextObject = {
  id: string;
  kind: 'text';
  x: number; y: number;   // 左上
  text: string;
  color: string;
  fontSize: number;
};

export type BoardObject = StrokeObject | TextObject;

export type ToolKind = 'pen' | 'eraser' | 'select' | 'text';

// --- WebSocket メッセージ ---
// クライアント → サーバー
export type ClientMessage =
  | { type: 'join'; room: string }
  | { type: 'add'; object: BoardObject }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'delete'; ids: string[] }
  | { type: 'clear' };

// サーバー → クライアント
export type ServerMessage =
  | { type: 'init'; objects: BoardObject[]; clientId: string }
  | { type: 'add'; object: BoardObject }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'delete'; ids: string[] }
  | { type: 'clear' }
  | { type: 'presence'; count: number };
