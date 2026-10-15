import { FONT_FAMILY } from './render.ts';

export interface TextEditorOptions {
  container: HTMLElement;
  x: number;
  y: number;
  initial: string;
  color: string;
  fontSize: number;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export interface TextEditorHandle {
  /** Submits the current text and removes the editor. */
  commit: () => void;
  /** Removes the editor without submitting. */
  cancel: () => void;
}

/**
 * Textarea overlay used for text input. Enter inserts a newline, Ctrl/Cmd+Enter or blur submits,
 * Escape cancels. Enter pressed while an IME is composing (Japanese input) is left to the IME.
 */
export function openTextEditor(options: TextEditorOptions): TextEditorHandle {
  const textarea = document.createElement('textarea');
  textarea.className = 'text-editor';
  textarea.value = options.initial;
  textarea.rows = 1;
  textarea.spellcheck = false;
  textarea.autocapitalize = 'off';
  textarea.setAttribute('aria-label', 'テキスト入力');
  textarea.style.left = `${options.x}px`;
  textarea.style.top = `${options.y}px`;
  textarea.style.color = options.color;
  textarea.style.fontSize = `${options.fontSize}px`;
  textarea.style.fontFamily = FONT_FAMILY;
  textarea.style.lineHeight = '1.3';
  options.container.append(textarea);

  let finished = false;

  function finish(submit: boolean): void {
    if (finished) return;
    finished = true;
    const value = textarea.value;
    textarea.remove();
    if (submit) options.onSubmit(value);
    else options.onCancel();
  }

  textarea.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      finish(false);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finish(true);
    }
  });

  textarea.addEventListener('blur', () => finish(true));

  // Focus now, since this runs inside the pointer handler (needed for mobile keyboards).
  // Focus again after the event: the browser's default pointer focus change can take it away.
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  requestAnimationFrame(() => {
    if (!finished && document.activeElement !== textarea) textarea.focus();
  });

  return {
    commit: () => finish(true),
    cancel: () => finish(false),
  };
}
