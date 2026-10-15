import { TEXT_FONT_FAMILY } from '../shared/constants.js';
import { TEXT_LINE_HEIGHT_RATIO } from './renderer.js';

export type TextInputOptions = {
  container: HTMLElement;
  x: number;
  y: number;
  color: string;
  fontSize: number;
  onCommit(text: string): void;
  onCancel(): void;
};

const MIN_WIDTH_PX = 120;
const BORDER_ALLOWANCE_PX = 4; // 1px border on each side (box-sizing: border-box)

// Module-level: the close function of the overlay currently on screen, if any.
let activeClose: (() => void) | null = null;

export function isTextInputOpen(): boolean {
  return activeClose !== null;
}

export function openTextInput(opts: TextInputOptions): { close(): void; isOpen(): boolean } {
  // Only one overlay at a time: commit the previous one first.
  if (activeClose !== null) activeClose();

  const ta = document.createElement('textarea');
  ta.className = 'text-input-overlay';
  ta.rows = 1;
  ta.style.left = `${opts.x}px`;
  ta.style.top = `${opts.y}px`;
  ta.style.fontSize = `${opts.fontSize}px`;
  ta.style.color = opts.color;
  ta.style.lineHeight = String(TEXT_LINE_HEIGHT_RATIO);
  ta.style.fontFamily = TEXT_FONT_FAMILY;
  opts.container.appendChild(ta);

  let done = false;
  let composing = false;

  function fit(): void {
    // Shrink first so scrollWidth/scrollHeight reflect the content rather than the previous size.
    ta.style.width = '0px';
    ta.style.height = '0px';
    ta.style.width = `${Math.max(MIN_WIDTH_PX, ta.scrollWidth + BORDER_ALLOWANCE_PX)}px`;
    ta.style.height = `${ta.scrollHeight + BORDER_ALLOWANCE_PX}px`;
  }

  function teardown(): void {
    done = true;
    ta.remove();
    if (activeClose === close) activeClose = null;
  }

  function commit(): void {
    if (done) return;
    const value = ta.value;
    teardown();
    if (value.trim() === '') {
      opts.onCancel();
    } else {
      opts.onCommit(value);
    }
  }

  function cancel(): void {
    if (done) return;
    teardown();
    opts.onCancel();
  }

  // close() finalizes the overlay the same way blur does (commit, or cancel when empty).
  function close(): void {
    commit();
  }

  ta.addEventListener('input', fit);
  ta.addEventListener('compositionstart', () => {
    composing = true;
  });
  ta.addEventListener('compositionend', () => {
    composing = false;
  });
  ta.addEventListener('keydown', (e) => {
    // Keys pressed during IME composition belong to the IME (keyCode 229 is the legacy marker).
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      if (e.shiftKey) return; // Shift+Enter inserts a newline
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  ta.addEventListener('blur', () => {
    commit();
  });

  activeClose = close;
  fit();
  ta.focus();

  return { close, isOpen: () => !done };
}
