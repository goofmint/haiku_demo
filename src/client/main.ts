import './style.css';
import type { BoardObject, ServerMessage, TextObject } from '../shared/types.js';
import { createBoardState } from './state.js';
import { createRenderer } from './renderer.js';
import { attachPointerHandlers } from './tools.js';
import { isTextInputOpen, openTextInput as openTextInputOverlay } from './text-input.js';
import type { SyncStatus } from './sync.js';
import { createSync } from './sync.js';
import { createToolbar } from './toolbar.js';
import { downloadPng } from './export.js';
import { generateId } from '../shared/id.js';

// --- DOM 要素 ---
const toolbarEl = document.getElementById('toolbar');
if (!(toolbarEl instanceof HTMLElement)) throw new Error('main: #toolbar element not found');
const boardEl = document.getElementById('board');
if (!(boardEl instanceof HTMLElement)) throw new Error('main: #board element not found');
const canvasEl = document.getElementById('canvas');
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('main: #canvas element not found');

// --- ルーム ---
const roomParam = new URLSearchParams(location.search).get('room');
let room: string;
if (roomParam === null || roomParam === '') {
  room = generateId().slice(0, 8);
  const url = new URL(location.href);
  url.searchParams.set('room', room);
  history.replaceState(null, '', url.toString());
} else {
  room = roomParam;
}

// --- 各モジュール生成 ---
const state = createBoardState();
const renderer = createRenderer(canvasEl);

// 描画要求は 1 フレームに 1 回へまとめる
let renderScheduled = false;
function requestRender(): void {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderer.render(state.getObjects(), state.getSelectedIds(), tools.getInProgressStroke(), tools.getSelectionRect());
  });
}
state.subscribe(requestRender);

// ローカル適用 + 送信のラッパー
function addAndSend(obj: BoardObject): void {
  state.addObject(obj, true);
  sync.send({ type: 'add', object: obj });
}

function deleteAndSend(ids: string[]): void {
  if (ids.length === 0) return;
  state.deleteObjects(ids);
  sync.send({ type: 'delete', ids });
}

// テキスト入力オーバーレイ。ペン等での描画開始時に確定させるため保持する
let textOverlay: { close(): void; isOpen(): boolean } | null = null;
canvasEl.addEventListener('pointerdown', () => {
  if (textOverlay !== null) textOverlay.close();
});

canvasEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
});

const tools = attachPointerHandlers(canvasEl, {
  state,
  renderer,
  addObject: addAndSend,
  deleteObjects: deleteAndSend,
  sendMove(ids, dx, dy) {
    sync.send({ type: 'move', ids, dx, dy });
  },
  openTextInput(x, y) {
    const color = state.getColor();
    const fontSize = state.getFontSize();
    textOverlay = openTextInputOverlay({
      container: boardEl,
      x,
      y,
      color,
      fontSize,
      onCommit(text) {
        const obj: TextObject = { id: generateId(), kind: 'text', x, y, text, color, fontSize };
        addAndSend(obj);
      },
      onCancel() {},
    });
  },
  requestRender,
});

// --- 同期 ---
let currentStatus: SyncStatus = 'connecting';
let lastCount = 0;

const toolbar = createToolbar(toolbarEl, {
  state,
  onUndo() {
    const id = state.popMyLastObjectId();
    if (id !== null) deleteAndSend([id]);
  },
  onDeleteSelected() {
    deleteAndSend(Array.from(state.getSelectedIds()));
  },
  onClear() {
    state.clear();
    sync.send({ type: 'clear' });
  },
  onDownload() {
    downloadPng(renderer.getCanvas(), `whiteboard-${room}.png`);
  },
});

// createSync は生成時に onStatus('connecting') を同期呼び出しするため、toolbar の後に生成する
const sync = createSync({
  room,
  onMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'init':
        state.replaceAll(msg.objects);
        break;
      case 'add':
        state.addObject(msg.object, false);
        break;
      case 'move':
        state.moveObjects(msg.ids, msg.dx, msg.dy);
        break;
      case 'delete':
        state.deleteObjects(msg.ids);
        break;
      case 'clear':
        state.clear();
        break;
      case 'presence':
        lastCount = msg.count;
        toolbar.setStatus(currentStatus, lastCount);
        break;
    }
  },
  onStatus(status) {
    currentStatus = status;
    toolbar.setStatus(status, lastCount);
  },
});

// --- リサイズ ---
function handleResize(): void {
  renderer.resize();
  requestRender();
}
handleResize();
window.addEventListener('resize', handleResize);
const viewport = window.visualViewport;
if (viewport !== null) viewport.addEventListener('resize', handleResize);

// --- キーボード ---
function undo(): void {
  const id = state.popMyLastObjectId();
  if (id !== null) deleteAndSend([id]);
}

window.addEventListener('keydown', (e: KeyboardEvent) => {
  if (isTextInputOpen()) return;
  const target = e.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return;
  }

  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
    return;
  }
  if (e.altKey) return;

  switch (e.key) {
    case 'Delete':
    case 'Backspace': {
      const ids = Array.from(state.getSelectedIds());
      if (ids.length > 0) {
        e.preventDefault();
        deleteAndSend(ids);
      }
      return;
    }
    case 'Escape':
      if (state.getSelectedIds().size > 0) state.setSelection([]);
      return;
    case 'p':
      state.setTool('pen');
      return;
    case 'e':
      state.setTool('eraser');
      return;
    case 'v':
      state.setTool('select');
      return;
    case 't':
      state.setTool('text');
      return;
  }
});

// Canvas は touch-action: none (style.css) でダブルタップズームを抑止済み
