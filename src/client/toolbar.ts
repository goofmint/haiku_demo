import type { StrokeStyle } from '../shared/types';
import type { ToolName } from './config';
import {
  FONT_SIZE_OPTIONS,
  PRESET_COLORS,
  STROKE_STYLE_ORDER,
  STROKE_WIDTH_MAX,
  STROKE_WIDTH_MIN,
  STROKE_WIDTH_STEP,
  TOOL_ORDER,
} from './config';
import type { ConnectionState } from './connection';
import { MESSAGES } from './messages';
import type { Settings } from './tools/types';

/** 24×24 の線画アイコン(静的な定数文字列のみを innerHTML に入れる) */
function svgIcon(body: string): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

const TOOL_ICONS: Record<ToolName, string> = {
  select: svgIcon('<path d="M5 3l14 8-6 2-3 6z"/>'),
  pen: svgIcon('<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>'),
  eraser: svgIcon('<path d="M8 20h12"/><path d="M4.5 15.5l9-9a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 18H8z"/>'),
  text: svgIcon('<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'),
  pan: svgIcon('<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
};

const ICONS = {
  pressure: svgIcon('<path d="M3 17c3 0 4-10 7-10s3 10 6 10 3-6 5-6"/>'),
  undo: svgIcon('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svgIcon('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  deleteSelected: svgIcon('<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>'),
  clearAll: svgIcon('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  exportPng: svgIcon('<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
  share: svgIcon('<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8"/>'),
  participants: svgIcon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
};

export type ToolbarActions = {
  onToolChange(tool: ToolName): void;
  onColorChange(color: string): void;
  onWidthChange(width: number): void;
  onStyleChange(style: StrokeStyle): void;
  onPressureToggle(): void;
  onFontSizeChange(size: number): void;
  onUndo(): void;
  onRedo(): void;
  onDeleteSelected(): void;
  onClearAll(): void;
  onExportPng(): void;
  onShare(): void;
};

export type ToolbarState = {
  settings: Readonly<Settings>;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  canEdit: boolean;
  connection: ConnectionState;
  participants: number;
};

export type Toolbar = {
  element: HTMLElement;
  update(state: ToolbarState): void;
};

function iconButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tb-button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  button.addEventListener('click', onClick);
  return button;
}

function group(...children: HTMLElement[]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'tb-group';
  div.append(...children);
  return div;
}

function isStrokeStyle(value: string): value is StrokeStyle {
  return STROKE_STYLE_ORDER.some((s) => s === value);
}

export function createToolbar(actions: ToolbarActions): Toolbar {
  const root = document.createElement('div');
  root.className = 'toolbar';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', MESSAGES.toolbarLabel);

  // ツール
  const toolButtons = new Map<ToolName, HTMLButtonElement>();
  for (const tool of TOOL_ORDER) {
    const button = iconButton(MESSAGES.tools[tool], TOOL_ICONS[tool], () => actions.onToolChange(tool));
    toolButtons.set(tool, button);
  }

  // 色
  const colorButtons = new Map<string, HTMLButtonElement>();
  for (const color of PRESET_COLORS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tb-button tb-swatch';
    button.title = MESSAGES.colorPreset(color);
    button.setAttribute('aria-label', MESSAGES.colorPreset(color));
    button.style.setProperty('--swatch', color);
    button.addEventListener('click', () => actions.onColorChange(color));
    colorButtons.set(color, button);
  }
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'tb-color';
  colorInput.title = MESSAGES.customColor;
  colorInput.setAttribute('aria-label', MESSAGES.customColor);
  colorInput.addEventListener('input', () => actions.onColorChange(colorInput.value));

  // 太さ
  const widthInput = document.createElement('input');
  widthInput.type = 'range';
  widthInput.className = 'tb-range';
  widthInput.min = String(STROKE_WIDTH_MIN);
  widthInput.max = String(STROKE_WIDTH_MAX);
  widthInput.step = String(STROKE_WIDTH_STEP);
  widthInput.title = MESSAGES.strokeWidth;
  widthInput.setAttribute('aria-label', MESSAGES.strokeWidth);
  widthInput.addEventListener('input', () => actions.onWidthChange(widthInput.valueAsNumber));
  const widthValue = document.createElement('span');
  widthValue.className = 'tb-value';
  widthValue.setAttribute('aria-hidden', 'true');

  // 線種
  const styleSelect = document.createElement('select');
  styleSelect.className = 'tb-select';
  styleSelect.title = MESSAGES.strokeStyle;
  styleSelect.setAttribute('aria-label', MESSAGES.strokeStyle);
  for (const style of STROKE_STYLE_ORDER) {
    styleSelect.append(new Option(MESSAGES.strokeStyles[style], style));
  }
  styleSelect.addEventListener('change', () => {
    const value = styleSelect.value;
    if (isStrokeStyle(value)) actions.onStyleChange(value);
  });

  // 筆圧
  const pressureButton = iconButton(MESSAGES.pressure, ICONS.pressure, () => actions.onPressureToggle());

  // 文字サイズ
  const fontSelect = document.createElement('select');
  fontSelect.className = 'tb-select';
  fontSelect.title = MESSAGES.fontSize;
  fontSelect.setAttribute('aria-label', MESSAGES.fontSize);
  for (const size of FONT_SIZE_OPTIONS) {
    fontSelect.append(new Option(MESSAGES.fontSizeOption(size), String(size)));
  }
  fontSelect.addEventListener('change', () => {
    const size = Number(fontSelect.value);
    if (FONT_SIZE_OPTIONS.includes(size)) actions.onFontSizeChange(size);
  });

  // 履歴・削除・書き出し・共有
  const undoButton = iconButton(MESSAGES.undo, ICONS.undo, () => actions.onUndo());
  const redoButton = iconButton(MESSAGES.redo, ICONS.redo, () => actions.onRedo());
  const deleteButton = iconButton(MESSAGES.deleteSelected, ICONS.deleteSelected, () =>
    actions.onDeleteSelected(),
  );
  const clearButton = iconButton(MESSAGES.clearAll, ICONS.clearAll, () => actions.onClearAll());
  const exportButton = iconButton(MESSAGES.exportPng, ICONS.exportPng, () => actions.onExportPng());
  const shareButton = iconButton(MESSAGES.share, ICONS.share, () => actions.onShare());

  // 接続状態・参加人数
  const status = document.createElement('div');
  status.className = 'tb-status';
  status.setAttribute('role', 'status');
  const statusDot = document.createElement('span');
  statusDot.className = 'tb-status-dot';
  statusDot.setAttribute('aria-hidden', 'true');
  const statusText = document.createElement('span');
  statusText.className = 'tb-status-text';
  const participants = document.createElement('span');
  participants.className = 'tb-participants';
  const participantsIcon = document.createElement('span');
  participantsIcon.innerHTML = ICONS.participants;
  const participantsCount = document.createElement('span');
  participants.append(participantsIcon, participantsCount);
  status.append(statusDot, statusText, participants);

  root.append(
    group(...toolButtons.values()),
    group(...colorButtons.values(), colorInput),
    group(widthInput, widthValue, styleSelect, pressureButton),
    group(fontSelect),
    group(undoButton, redoButton),
    group(deleteButton, clearButton),
    group(exportButton, shareButton),
    status,
  );

  function update(state: ToolbarState): void {
    const { settings } = state;
    for (const [tool, button] of toolButtons) {
      const active = tool === settings.tool;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    for (const [color, button] of colorButtons) {
      const active = color.toLowerCase() === settings.color.toLowerCase();
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    if (colorInput.value !== settings.color) colorInput.value = settings.color;
    if (widthInput.valueAsNumber !== settings.width) widthInput.value = String(settings.width);
    widthValue.textContent = String(settings.width);
    if (styleSelect.value !== settings.style) styleSelect.value = settings.style;
    pressureButton.classList.toggle('is-active', settings.pressure);
    pressureButton.setAttribute('aria-pressed', String(settings.pressure));
    if (fontSelect.value !== String(settings.fontSize)) fontSelect.value = String(settings.fontSize);

    undoButton.disabled = !state.canEdit || !state.canUndo;
    redoButton.disabled = !state.canEdit || !state.canRedo;
    deleteButton.disabled = !state.canEdit || !state.hasSelection;
    clearButton.disabled = !state.canEdit;

    status.dataset['state'] = state.connection;
    statusText.textContent = MESSAGES.connection[state.connection];
    const label = MESSAGES.participants(state.participants);
    participants.title = label;
    participants.setAttribute('aria-label', label);
    participantsCount.textContent = String(state.participants);
  }

  return { element: root, update };
}
