import type { Board, BoardState, Tool } from './board.ts';
import type { ConnectionStatus } from './net.ts';
import { downloadPng } from './exportPng.ts';
import { LINE_STYLES, type LineStyle } from '../shared/model.ts';

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: '接続中…',
  online: 'オンライン',
  offline: '再接続中…',
};

const ACTIVE_CLASS = 'is-active';

function requireElement<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

function isLineStyle(value: string): value is LineStyle {
  return (LINE_STYLES as readonly string[]).includes(value);
}

function isTool(value: string): value is Tool {
  return value === 'pen' || value === 'eraser' || value === 'select' || value === 'text';
}

/** Reflects board state in the toolbar. Only touches the DOM, so it is safe to call before wiring. */
export function renderToolbarState(state: BoardState): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    const active = button.dataset.tool === state.tool;
    button.classList.toggle(ACTIVE_CLASS, active);
    button.setAttribute('aria-pressed', String(active));
  }
  const multi = requireElement<HTMLButtonElement>('#multi-toggle');
  multi.classList.toggle(ACTIVE_CLASS, state.multiSelect);
  multi.setAttribute('aria-pressed', String(state.multiSelect));

  requireElement<HTMLInputElement>('#color-input').value = state.color;
  requireElement<HTMLSelectElement>('#width-select').value = String(state.width);
  requireElement<HTMLSelectElement>('#style-select').value = state.lineStyle;
  requireElement<HTMLButtonElement>('#delete-btn').disabled = state.selectedCount === 0;
}

export function setConnectionStatus(status: ConnectionStatus): void {
  const element = requireElement<HTMLElement>('#status');
  element.textContent = STATUS_TEXT[status];
  element.dataset.status = status;
}

async function copyShareUrl(): Promise<void> {
  const message = requireElement<HTMLElement>('#share-message');
  try {
    await navigator.clipboard.writeText(location.href);
    message.textContent = 'URLをコピーしました';
  } catch {
    // Clipboard access is blocked on some insecure (http) origins; let the user copy by hand.
    window.prompt('このURLを共有してください', location.href);
    message.textContent = '';
  }
  window.setTimeout(() => {
    message.textContent = '';
  }, 2500);
}

export function wireToolbar(board: Board): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
    button.addEventListener('click', () => {
      const tool = button.dataset.tool ?? '';
      if (isTool(tool)) board.setTool(tool);
    });
  }

  for (const swatch of document.querySelectorAll<HTMLButtonElement>('[data-color]')) {
    swatch.addEventListener('click', () => {
      if (swatch.dataset.color) board.setColor(swatch.dataset.color);
    });
  }

  requireElement<HTMLInputElement>('#color-input').addEventListener('input', (event) => {
    board.setColor((event.target as HTMLInputElement).value);
  });

  requireElement<HTMLSelectElement>('#width-select').addEventListener('change', (event) => {
    board.setWidth(Number((event.target as HTMLSelectElement).value));
  });

  requireElement<HTMLSelectElement>('#style-select').addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value;
    if (isLineStyle(value)) board.setLineStyle(value);
  });

  requireElement<HTMLButtonElement>('#multi-toggle').addEventListener('click', () => {
    const current = requireElement<HTMLButtonElement>('#multi-toggle').getAttribute('aria-pressed') === 'true';
    board.setMultiSelect(!current);
  });

  requireElement<HTMLButtonElement>('#delete-btn').addEventListener('click', () => board.deleteSelected());

  requireElement<HTMLButtonElement>('#clear-btn').addEventListener('click', () => {
    if (window.confirm('ボード上のすべての線と文字を消去します。よろしいですか？')) board.clearAll();
  });

  requireElement<HTMLButtonElement>('#png-btn').addEventListener('click', () => {
    if (!downloadPng(board.getObjects())) {
      window.alert('保存する内容がありません。');
    }
  });

  requireElement<HTMLButtonElement>('#share-btn').addEventListener('click', () => {
    void copyShareUrl();
  });

  board.notify();
}
