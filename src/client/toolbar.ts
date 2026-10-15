import { COLOR_PRESETS, WIDTH_PRESETS } from '../shared/constants.js';
import type { LineStyle, ToolKind } from '../shared/types.js';
import type { BoardState } from './state.js';

export type ToolbarDeps = {
  state: BoardState;
  onUndo(): void; onDeleteSelected(): void; onClear(): void; onDownload(): void;
};
export type Toolbar = { setStatus(status: 'connecting' | 'connected' | 'disconnected', count: number): void; refresh(): void };

const TOOL_OPTIONS: { tool: ToolKind; label: string }[] = [
  { tool: 'pen', label: 'ペン' },
  { tool: 'eraser', label: '消しゴム' },
  { tool: 'select', label: '選択' },
  { tool: 'text', label: 'テキスト' },
];

const LINE_STYLE_OPTIONS: { value: LineStyle; label: string }[] = [
  { value: 'solid', label: '実線' },
  { value: 'dashed', label: '破線' },
  { value: 'dotted', label: '点線' },
];

const WIDTH_RANGE_MIN = 1;
const WIDTH_RANGE_MAX = 30;
const CONFIRM_CLEAR_MESSAGE = 'ボード上の全オブジェクトを消去しますか？';

function isLineStyle(v: string): v is LineStyle {
  return LINE_STYLE_OPTIONS.some((o) => o.value === v);
}

function createButton(label: string, className: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  return button;
}

function createGroup(nodes: HTMLElement[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'toolbar-group';
  group.append(...nodes);
  return group;
}

export function createToolbar(root: HTMLElement, deps: ToolbarDeps): Toolbar {
  const { state } = deps;

  // Tools
  const toolButtons = TOOL_OPTIONS.map(({ tool, label }) => {
    const el = createButton(label, 'tool-btn');
    el.addEventListener('click', () => state.setTool(tool));
    return { tool, el };
  });

  // Colors
  const swatches = COLOR_PRESETS.map((color) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'color-swatch';
    el.style.backgroundColor = color;
    el.setAttribute('aria-label', color);
    el.title = color;
    el.addEventListener('click', () => state.setColor(color));
    return { color, el };
  });
  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.className = 'color-picker';
  colorPicker.setAttribute('aria-label', 'カスタム色');
  colorPicker.addEventListener('input', () => state.setColor(colorPicker.value));

  // Widths
  const widthButtons = WIDTH_PRESETS.map((width) => {
    const el = createButton(String(width), 'width-btn');
    el.setAttribute('aria-label', `線幅 ${width}`);
    el.addEventListener('click', () => state.setWidth(width));
    return { width, el };
  });
  const widthRange = document.createElement('input');
  widthRange.type = 'range';
  widthRange.className = 'width-range';
  widthRange.min = String(WIDTH_RANGE_MIN);
  widthRange.max = String(WIDTH_RANGE_MAX);
  widthRange.step = '1';
  widthRange.setAttribute('aria-label', '線幅スライダー');
  widthRange.addEventListener('input', () => state.setWidth(Number(widthRange.value)));

  // Line style
  const styleSelect = document.createElement('select');
  styleSelect.className = 'line-style-select';
  styleSelect.setAttribute('aria-label', '線の種類');
  LINE_STYLE_OPTIONS.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    styleSelect.appendChild(option);
  });
  styleSelect.addEventListener('change', () => {
    const v = styleSelect.value;
    if (isLineStyle(v)) state.setLineStyle(v);
  });

  // Actions
  const undoBtn = createButton('元に戻す', 'tool-btn');
  undoBtn.addEventListener('click', () => deps.onUndo());
  const deleteBtn = createButton('選択削除', 'tool-btn');
  deleteBtn.addEventListener('click', () => deps.onDeleteSelected());
  const clearBtn = createButton('全消去', 'tool-btn');
  clearBtn.addEventListener('click', () => {
    if (confirm(CONFIRM_CLEAR_MESSAGE)) deps.onClear();
  });
  const pngBtn = createButton('PNG保存', 'tool-btn');
  pngBtn.addEventListener('click', () => deps.onDownload());

  // Status
  const statusEl = document.createElement('span');
  statusEl.className = 'status';

  root.append(
    createGroup(toolButtons.map((b) => b.el)),
    createGroup([...swatches.map((s) => s.el), colorPicker]),
    createGroup([...widthButtons.map((w) => w.el), widthRange]),
    createGroup([styleSelect]),
    createGroup([undoBtn, deleteBtn, clearBtn, pngBtn]),
    statusEl,
  );

  function setStatus(status: 'connecting' | 'connected' | 'disconnected', count: number): void {
    statusEl.classList.remove('status-connecting', 'status-connected', 'status-disconnected');
    if (status === 'connected') {
      statusEl.classList.add('status-connected');
      statusEl.textContent = `● 接続中 · ${count}人`;
    } else if (status === 'connecting') {
      statusEl.classList.add('status-connecting');
      statusEl.textContent = '○ 接続中…';
    } else {
      statusEl.classList.add('status-disconnected');
      statusEl.textContent = '● 切断';
    }
  }

  function refresh(): void {
    const tool = state.getTool();
    toolButtons.forEach(({ tool: t, el }) => el.classList.toggle('active', t === tool));

    const color = state.getColor();
    swatches.forEach(({ color: c, el }) => el.classList.toggle('active', c.toLowerCase() === color.toLowerCase()));
    colorPicker.value = color;

    const width = state.getWidth();
    widthButtons.forEach(({ width: w, el }) => el.classList.toggle('active', w === width));
    widthRange.value = String(width);

    styleSelect.value = state.getLineStyle();

    deleteBtn.disabled = state.getSelectedIds().size === 0;
  }

  state.subscribe(refresh);
  refresh();

  return { setStatus, refresh };
}
