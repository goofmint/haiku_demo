import type { ClientMessage } from '../../shared/protocol';
import type { BoardObject, StrokeObject, StrokeStyle, TextObject } from '../../shared/types';
import type { Board, BoardOp } from '../board';
import type { Camera } from '../camera';
import type { ToolName } from '../config';
import type { MeasureText, Rect } from '../geometry';
import type { Command, History } from '../history';

/** ツールに渡すポインタ情報 */
export type PointerInfo = {
  /** ワールド座標 */
  x: number;
  y: number;
  /** キャンバス左上を原点とする画面座標(CSS ピクセル) */
  sx: number;
  sy: number;
  /** 0〜1。ペン以外は一定値 */
  pressure: number;
  pointerType: string;
  shiftKey: boolean;
};

/** すべてのツールの共通インターフェース */
export type Tool = {
  onDown(p: PointerInfo): void;
  onMove(p: PointerInfo): void;
  onUp(p: PointerInfo): void;
  /** 進行中の操作を取り消す(ピンチ開始・切断・ツール切替など) */
  onCancel(): void;
};

export type Settings = {
  tool: ToolName;
  color: string;
  width: number;
  style: StrokeStyle;
  pressure: boolean;
  fontSize: number;
};

/** 他ユーザーの描画中の線 */
export type RemoteDraft = { clientId: string; stroke: StrokeObject };

export type TextEditTarget =
  | { kind: 'new'; x: number; y: number }
  | { kind: 'existing'; object: TextObject };

/** main.ts が作り、各ツールに渡す編集コンテキスト */
export type EditorContext = {
  board: Board;
  history: History;
  measure: MeasureText;
  settings: Settings;
  getCamera(): Camera;
  setCamera(c: Camera): void;
  getSelection(): ReadonlySet<string>;
  setSelection(ids: Iterable<string>): void;
  /** 自分の描画中の線(pen ツールが設定する) */
  ownDraft: StrokeObject | null;
  remoteDrafts: Map<string, RemoteDraft>;
  /** 範囲選択の矩形(ワールド座標) */
  marquee: Rect | null;
  /** 描画・当たり判定から除外するオブジェクト(テキスト再編集中のもの) */
  hiddenIds: Set<string>;
  /** 表示中(hiddenIds を除く)のオブジェクトを重なり順で返す */
  visibleObjects(): BoardObject[];
  requestRender(): void;
  /** 接続中のみ true。false の間は編集操作を行わない */
  canEdit(): boolean;
  /** board.apply(op) + history.push(cmd) + 送信 */
  commit(op: BoardOp, cmd: Command): void;
  /** 適用済みの操作を送信し、履歴に積む(ローカル適用は呼び出し側で済ませている場合) */
  publish(op: BoardOp, cmd: Command): void;
  send(msg: ClientMessage): void;
  openTextEditor(target: TextEditTarget): void;
};
