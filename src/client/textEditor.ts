import { LIMITS } from '../shared/limits';
import type { TextObject } from '../shared/types';
import type { Board, BoardOp } from './board';
import { cloneObject } from './board';
import type { Camera } from './camera';
import { worldToScreen } from './camera';
import {
  IOS_MIN_INPUT_FONT_PX,
  TEXT_EDITOR_CARET_ROOM_EM,
  TEXT_EDITOR_MIN_WIDTH_EM,
} from './config';
import { FONT_FAMILY, LINE_HEIGHT } from './drawStyle';
import type { MeasureText } from './geometry';
import type { Command } from './history';
import { MESSAGES } from './messages';
import type { TextEditTarget } from './tools/types';
import { createId } from './id';

/** IME 変換中の keydown で報告される keyCode */
const IME_PROCESS_KEY_CODE = 229;

const EDITOR_CLASS = 'text-editor';

export type TextEditorDeps = {
  /** textarea を置く要素(キャンバスと同じ原点を持つこと) */
  container: HTMLElement;
  board: Board;
  measure: MeasureText;
  getCamera(): Camera;
  /** 新規テキストに使う色と文字サイズ */
  getStyle(): { color: string; fontSize: number };
  /** 確定した操作を反映する(board.apply + history.push + 送信) */
  onCommit(op: BoardOp, cmd: Command): void;
  /** 再編集中で描画から隠すオブジェクトが変わったとき */
  onHiddenChange(id: string | null): void;
};

export type TextEditor = {
  /** 開く。既に開いていれば先に確定する。pointerup などユーザー操作の処理中に同期的に呼ぶこと */
  open(target: TextEditTarget): void;
  /** 内容を確定して閉じる */
  commit(): void;
  /** 内容を捨てて閉じる */
  discard(): void;
  isOpen(): boolean;
  /** カメラが変わったときに位置・倍率を合わせ直す */
  layout(): void;
};

type Session = {
  textarea: HTMLTextAreaElement;
  /** 再編集中のオブジェクト id。新規なら null */
  existingId: string | null;
  x: number;
  y: number;
  color: string;
  fontSize: number;
  /** compositionstart〜compositionend の間 true */
  composing: boolean;
  /** compositionend の直後(Safari では確定の Enter の keydown が後から来る) */
  justComposed: boolean;
  /** CSS 上の font-size(px) */
  cssFontSize: number;
  detach(): void;
};

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

export function createTextEditor(deps: TextEditorDeps): TextEditor {
  let session: Session | null = null;

  function autosize(s: Session): void {
    const lines = s.textarea.value.split('\n');
    let width = 0;
    for (const line of lines) width = Math.max(width, deps.measure(line, s.cssFontSize));
    const minWidth = s.cssFontSize * TEXT_EDITOR_MIN_WIDTH_EM;
    const caretRoom = s.cssFontSize * TEXT_EDITOR_CARET_ROOM_EM;
    s.textarea.style.width = `${Math.ceil(Math.max(width, minWidth) + caretRoom)}px`;
    s.textarea.style.height = `${Math.ceil(lines.length * s.cssFontSize * LINE_HEIGHT)}px`;
  }

  function layoutSession(s: Session): void {
    const camera = deps.getCamera();
    const screen = worldToScreen(camera, s.x, s.y);
    const visualFontSize = s.fontSize * camera.zoom;
    // iOS は font-size 16px 未満の入力欄で自動ズームするため、16px で描いて縮小する
    const useScale = visualFontSize < IOS_MIN_INPUT_FONT_PX;
    s.cssFontSize = useScale ? IOS_MIN_INPUT_FONT_PX : visualFontSize;
    const scale = useScale ? visualFontSize / IOS_MIN_INPUT_FONT_PX : 1;
    // キャンバスは textBaseline='top' で em ボックス上端に描くため、行の上側の余白(half-leading)分だけ上げる
    const halfLeading = ((LINE_HEIGHT - 1) / 2) * visualFontSize;
    const style = s.textarea.style;
    style.left = `${screen.x}px`;
    style.top = `${screen.y - halfLeading}px`;
    style.fontSize = `${s.cssFontSize}px`;
    style.transform = useScale ? `scale(${scale})` : 'none';
    autosize(s);
  }

  function close(): Session | null {
    const s = session;
    if (!s) return null;
    session = null;
    s.detach();
    s.textarea.remove();
    deps.onHiddenChange(null);
    return s;
  }

  function finalize(s: Session): void {
    const text = s.textarea.value;
    const blank = isBlank(text);

    if (s.existingId === null) {
      if (blank) return;
      const obj: TextObject = {
        id: createId(),
        kind: 'text',
        x: s.x,
        y: s.y,
        text,
        color: s.color,
        fontSize: s.fontSize,
      };
      deps.onCommit({ type: 'add', objects: [obj] }, { type: 'add', objects: [obj] });
      return;
    }

    const current = deps.board.get(s.existingId);
    // 編集中に他の人に消されていたら編集内容は捨てる
    if (!current || current.kind !== 'text') return;
    if (blank) {
      deps.onCommit(
        { type: 'remove', ids: [current.id] },
        { type: 'remove', objects: [cloneObject(current)] },
      );
      return;
    }
    if (text === current.text) return;
    const before = cloneObject(current);
    const after: TextObject = { ...current, text };
    deps.onCommit({ type: 'update', object: after }, { type: 'update', before, after });
  }

  function commit(): void {
    const s = close();
    if (s) finalize(s);
  }

  function open(target: TextEditTarget): void {
    if (session) commit();

    const base =
      target.kind === 'new'
        ? { existingId: null, x: target.x, y: target.y, text: '', ...deps.getStyle() }
        : {
            existingId: target.object.id,
            x: target.object.x,
            y: target.object.y,
            text: target.object.text,
            color: target.object.color,
            fontSize: target.object.fontSize,
          };

    const textarea = document.createElement('textarea');
    textarea.className = EDITOR_CLASS;
    textarea.value = base.text;
    textarea.maxLength = LIMITS.maxTextLength;
    textarea.wrap = 'off';
    textarea.rows = 1;
    textarea.spellcheck = false;
    textarea.autocomplete = 'off';
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('aria-label', MESSAGES.textEditor);
    textarea.style.color = base.color;
    textarea.style.fontFamily = FONT_FAMILY;
    textarea.style.lineHeight = String(LINE_HEIGHT);

    const s: Session = {
      textarea,
      existingId: base.existingId,
      x: base.x,
      y: base.y,
      color: base.color,
      fontSize: base.fontSize,
      composing: false,
      justComposed: false,
      cssFontSize: IOS_MIN_INPUT_FONT_PX,
      detach: () => {},
    };

    const onInput = (): void => autosize(s);
    const onCompositionStart = (): void => {
      s.composing = true;
      s.justComposed = false;
    };
    const onCompositionEnd = (): void => {
      s.composing = false;
      s.justComposed = true;
    };
    const onKeyDown = (e: KeyboardEvent): void => {
      // グローバルのショートカットに渡さない
      e.stopPropagation();
      // IME 変換中のキー(確定の Enter・取消の Escape を含む)はブラウザの既定動作に任せる
      if (e.isComposing || e.keyCode === IME_PROCESS_KEY_CODE || s.composing) return;
      if (s.justComposed) {
        s.justComposed = false;
        if (e.key === 'Enter') return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        commit();
        return;
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        commit();
      }
      // それ以外の Enter は既定動作(改行)
    };
    const onBlur = (): void => {
      if (session === s) commit();
    };

    textarea.addEventListener('input', onInput);
    textarea.addEventListener('compositionstart', onCompositionStart);
    textarea.addEventListener('compositionend', onCompositionEnd);
    textarea.addEventListener('keydown', onKeyDown);
    textarea.addEventListener('blur', onBlur);
    s.detach = () => {
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('compositionstart', onCompositionStart);
      textarea.removeEventListener('compositionend', onCompositionEnd);
      textarea.removeEventListener('keydown', onKeyDown);
      textarea.removeEventListener('blur', onBlur);
    };

    session = s;
    deps.onHiddenChange(s.existingId);
    deps.container.appendChild(textarea);
    layoutSession(s);
    // iOS でソフトウェアキーボードを出すため、ユーザー操作の処理中に同期的に focus する
    textarea.focus({ preventScroll: true });
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }

  return {
    open,
    commit,
    discard() {
      close();
    },
    isOpen() {
      return session !== null;
    },
    layout() {
      if (session) layoutSession(session);
    },
  };
}
