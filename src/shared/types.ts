/** ワールド座標上の点。p は筆圧(0〜1) */
export type Point = { x: number; y: number; p: number };

export type StrokeStyle = 'solid' | 'dashed' | 'dotted' | 'marker';

export type StrokeObject = {
  /** UUID v4(クライアントの createId() で生成) */
  id: string;
  kind: 'stroke';
  points: Point[];
  /** '#rrggbb' */
  color: string;
  /** 基準線幅(ワールド単位) */
  width: number;
  style: StrokeStyle;
  /** 描画時に筆圧を使ったか */
  pressure: boolean;
};

export type TextObject = {
  id: string;
  kind: 'text';
  /** 左上のワールド座標 */
  x: number;
  y: number;
  /** 改行を含む */
  text: string;
  color: string;
  fontSize: number;
};

export type BoardObject = StrokeObject | TextObject;
