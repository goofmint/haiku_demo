import { LIMITS } from '../shared/limits';
import type { ServerMessage } from '../shared/protocol';
import type { BoardObject } from '../shared/types';
import type { BoardOp } from './board';
import { cloneObject, createBoard } from './board';
import type { Camera } from './camera';
import type { ToolName } from './config';
import {
  DEFAULT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_PRESSURE_ENABLED,
  DEFAULT_STROKE_STYLE,
  DEFAULT_TOOL,
  GENERATED_ROOM_ID_LENGTH,
  ROOM_QUERY_PARAM,
  STROKE_WIDTH_DEFAULT,
  TOAST_DURATION_MS,
} from './config';
import type { ConnectionState } from './connection';
import { createConnection, webSocketUrl } from './connection';
import { exportBoardPng } from './exportPng';
import type { Command, History } from './history';
import { createHistory } from './history';
import { createInput } from './input';
import { MESSAGES } from './messages';
import { createTextMeasurer, renderScene } from './render';
import { createTextEditor } from './textEditor';
import { createToolbar } from './toolbar';
import { createEraserTool } from './tools/eraser';
import { createPanTool } from './tools/pan';
import { createPenTool } from './tools/pen';
import { createSelectTool } from './tools/select';
import { createTextTool } from './tools/text';
import type { EditorContext, Settings, Tool } from './tools/types';
import { createId } from './id';

/** 文字入力を受け付ける要素(ここにフォーカスがある間はショートカットを無効にする) */
const NON_TYPING_INPUT_TYPES: readonly string[] = ['range', 'color', 'checkbox', 'radio', 'button'];

const TOOL_SHORTCUTS: Readonly<Record<string, ToolName>> = {
  v: 'select',
  p: 'pen',
  e: 'eraser',
  t: 'text',
  h: 'pan',
};

/** IME 変換中の keydown で報告される keyCode */
const IME_PROCESS_KEY_CODE = 229;

const SPACE_CODE = 'Space';
const SPACE_PAN_CLASS = 'is-space-pan';

type RoomResult = { ok: true; roomId: string } | { ok: false };

/** ?room= からルーム ID を決める。無ければ生成して URL に反映する。形式が不正なら ok: false */
function resolveRoomId(): RoomResult {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get(ROOM_QUERY_PARAM);
  if (raw === null) {
    const roomId = createId().slice(0, GENERATED_ROOM_ID_LENGTH);
    url.searchParams.set(ROOM_QUERY_PARAM, roomId);
    window.history.replaceState(null, '', url);
    return { ok: true, roomId };
  }
  if (!LIMITS.roomIdPattern.test(raw)) return { ok: false };
  return { ok: true, roomId: raw };
}

function showErrorScreen(root: HTMLElement, title: string, body: string): void {
  const screen = document.createElement('div');
  screen.className = 'error-screen';
  screen.setAttribute('role', 'alert');
  const h1 = document.createElement('h1');
  h1.textContent = title;
  const p = document.createElement('p');
  p.textContent = body;
  screen.append(h1, p);
  root.replaceChildren(screen);
}

function createToast(container: HTMLElement): (message: string) => void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  container.appendChild(el);
  let timer: number | null = null;
  return (message) => {
    el.textContent = message;
    el.classList.add('is-visible');
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      el.classList.remove('is-visible');
      timer = null;
    }, TOAST_DURATION_MS);
  };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TYPING_INPUT_TYPES.includes(target.type);
  return target instanceof HTMLElement && target.isContentEditable;
}

function main(): void {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app element is missing');
  document.title = MESSAGES.appTitle;

  const room = resolveRoomId();
  if (!room.ok) {
    showErrorScreen(root, MESSAGES.invalidRoomTitle, MESSAGES.invalidRoomBody);
    return;
  }

  // ---------------------------------------------------------------------------
  // キャンバス
  // ---------------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.className = 'board-canvas';
  root.appendChild(canvas);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D context is not available');

  let cssWidth = 0;
  let cssHeight = 0;
  let dpr = window.devicePixelRatio;

  // ---------------------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------------------
  const board = createBoard();
  const rawHistory = createHistory();
  const measure = createTextMeasurer();
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let selection = new Set<string>();
  let participants = 0;
  let connectionState: ConnectionState = 'connecting';
  let spaceHeld = false;
  const settings: Settings = {
    tool: DEFAULT_TOOL,
    color: DEFAULT_COLOR,
    width: STROKE_WIDTH_DEFAULT,
    style: DEFAULT_STROKE_STYLE,
    pressure: DEFAULT_PRESSURE_ENABLED,
    fontSize: DEFAULT_FONT_SIZE,
  };

  const connection = createConnection({ url: webSocketUrl(window.location), roomId: room.roomId });

  /** 履歴が変わったらツールバー(Undo/Redo の有効状態)を更新する */
  const history: History = {
    ...rawHistory,
    push(cmd) {
      rawHistory.push(cmd);
      refreshUi();
    },
    undo(exists) {
      const op = rawHistory.undo(exists);
      refreshUi();
      return op;
    },
    redo(exists) {
      const op = rawHistory.redo(exists);
      refreshUi();
      return op;
    },
    clear() {
      rawHistory.clear();
      refreshUi();
    },
  };

  // ---------------------------------------------------------------------------
  // 描画ループ
  // ---------------------------------------------------------------------------
  let frameId: number | null = null;

  function draw(): void {
    frameId = null;
    if (!g) return;
    const all = board.list();
    const objects = ctx.hiddenIds.size > 0 ? all.filter((o) => !ctx.hiddenIds.has(o.id)) : all;
    const drafts = [...ctx.remoteDrafts.values()].map((d) => d.stroke);
    if (ctx.ownDraft) drafts.push(ctx.ownDraft);
    renderScene(g, {
      objects,
      drafts,
      camera,
      selectedIds: selection,
      cssWidth,
      cssHeight,
      dpr,
      measure,
      marquee: ctx.marquee,
    });
  }

  function requestRender(): void {
    if (frameId === null) frameId = requestAnimationFrame(draw);
  }

  function resizeCanvas(): void {
    const rect = canvas.getBoundingClientRect();
    cssWidth = rect.width;
    cssHeight = rect.height;
    dpr = window.devicePixelRatio;
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    requestRender();
  }

  new ResizeObserver(resizeCanvas).observe(canvas);
  // ブラウザのズームなどで devicePixelRatio だけが変わった場合も resize イベントで拾う
  window.addEventListener('resize', resizeCanvas);

  // ---------------------------------------------------------------------------
  // 編集コンテキスト
  // ---------------------------------------------------------------------------
  function canEdit(): boolean {
    return connectionState === 'connected';
  }

  function setCamera(next: Camera): void {
    camera = next;
    textEditor.layout();
    requestRender();
  }

  function setSelection(ids: Iterable<string>): void {
    selection = new Set([...ids].filter((id) => board.get(id) !== undefined));
    requestRender();
    refreshUi();
  }

  function commit(op: BoardOp, cmd: Command): void {
    if (!canEdit()) return;
    board.apply(op);
    history.push(cmd);
    connection.send(op);
  }

  const ctx: EditorContext = {
    board,
    history,
    measure,
    settings,
    getCamera: () => camera,
    setCamera,
    getSelection: () => selection,
    setSelection,
    ownDraft: null,
    remoteDrafts: new Map(),
    marquee: null,
    hiddenIds: new Set(),
    visibleObjects() {
      const all = board.list();
      return ctx.hiddenIds.size > 0 ? all.filter((o) => !ctx.hiddenIds.has(o.id)) : all;
    },
    requestRender,
    canEdit,
    commit,
    publish(op, cmd) {
      if (!canEdit()) return;
      history.push(cmd);
      connection.send(op);
    },
    send(msg) {
      connection.send(msg);
    },
    openTextEditor(target) {
      if (!canEdit()) return;
      textEditor.open(target);
    },
  };

  const textEditor = createTextEditor({
    container: root,
    board,
    measure,
    getCamera: () => camera,
    getStyle: () => ({ color: settings.color, fontSize: settings.fontSize }),
    onCommit: commit,
    onHiddenChange(id) {
      ctx.hiddenIds.clear();
      if (id !== null) ctx.hiddenIds.add(id);
      requestRender();
    },
  });

  // ---------------------------------------------------------------------------
  // ツールと入力
  // ---------------------------------------------------------------------------
  const tools: Record<ToolName, Tool> = {
    select: createSelectTool(ctx),
    pen: createPenTool(ctx),
    eraser: createEraserTool(ctx),
    text: createTextTool(ctx),
    pan: createPanTool(ctx),
  };

  const input = createInput({
    canvas,
    getTool: () => tools[settings.tool],
    toolEdits: () => settings.tool !== 'pan',
    canEdit,
    getCamera: () => camera,
    setCamera,
    isSpaceHeld: () => spaceHeld,
    beforePointerDown() {
      // テキスト編集中にキャンバスを押したら確定する。その押下は他の操作に使わない
      if (!textEditor.isOpen()) return false;
      textEditor.commit();
      return true;
    },
  });

  // ---------------------------------------------------------------------------
  // 操作
  // ---------------------------------------------------------------------------
  function setTool(tool: ToolName): void {
    if (settings.tool === tool) return;
    input.cancel();
    textEditor.commit();
    settings.tool = tool;
    canvas.dataset['tool'] = tool;
    if (tool !== 'select' && selection.size > 0) setSelection([]);
    refreshUi();
  }

  function exists(id: string): boolean {
    return board.get(id) !== undefined;
  }

  function undo(): void {
    if (!canEdit()) return;
    input.cancel();
    const op = history.undo(exists);
    if (!op) return;
    board.apply(op);
    connection.send(op);
  }

  function redo(): void {
    if (!canEdit()) return;
    input.cancel();
    const op = history.redo(exists);
    if (!op) return;
    board.apply(op);
    connection.send(op);
  }

  function deleteSelection(): void {
    if (!canEdit()) return;
    const objects: BoardObject[] = [];
    for (const id of selection) {
      const obj = board.get(id);
      if (obj) objects.push(cloneObject(obj));
    }
    if (objects.length === 0) return;
    commit({ type: 'remove', ids: objects.map((o) => o.id) }, { type: 'remove', objects });
  }

  function clearAll(): void {
    if (!canEdit()) return;
    textEditor.commit();
    const objects = board.list().map(cloneObject);
    if (objects.length === 0) return;
    if (!window.confirm(MESSAGES.confirmClearAll)) return;
    // 確認ダイアログの間に切断されていたら何もしない
    if (!canEdit()) return;
    commit({ type: 'clear' }, { type: 'remove', objects });
  }

  async function exportPng(): Promise<void> {
    try {
      const result = await exportBoardPng(board.list(), measure);
      if (result === 'empty') showToast(MESSAGES.boardEmpty);
    } catch (err) {
      console.error(err);
      showToast(MESSAGES.exportFailed);
    }
  }

  async function copyUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      showToast(MESSAGES.urlCopied);
    } catch (err) {
      // navigator.clipboard は安全なコンテキスト(HTTPS・localhost)専用で、
      // LAN 内の端末から http://<IP> で開くと使えない。URL を表示して手でコピーしてもらう
      console.error(err);
      window.prompt(MESSAGES.copyFailed, url);
    }
  }

  async function share(): Promise<void> {
    const url = window.location.href;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: MESSAGES.shareTitle, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error(err);
      }
    }
    await copyUrl(url);
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const toolbar = createToolbar({
    onToolChange: setTool,
    onColorChange(color) {
      settings.color = color;
      refreshUi();
    },
    onWidthChange(width) {
      settings.width = width;
      refreshUi();
    },
    onStyleChange(style) {
      settings.style = style;
      refreshUi();
    },
    onPressureToggle() {
      settings.pressure = !settings.pressure;
      refreshUi();
    },
    onFontSizeChange(size) {
      settings.fontSize = size;
      refreshUi();
    },
    onUndo: undo,
    onRedo: redo,
    onDeleteSelected: deleteSelection,
    onClearAll: clearAll,
    onExportPng() {
      void exportPng();
    },
    onShare() {
      void share();
    },
  });
  root.appendChild(toolbar.element);

  const banner = document.createElement('div');
  banner.className = 'banner';
  banner.setAttribute('role', 'status');
  root.appendChild(banner);

  const showToast = createToast(root);

  function refreshUi(): void {
    toolbar.update({
      settings,
      canUndo: rawHistory.canUndo(),
      canRedo: rawHistory.canRedo(),
      hasSelection: selection.size > 0,
      canEdit: canEdit(),
      connection: connectionState,
      participants,
    });
    banner.hidden = connectionState === 'connected';
    banner.textContent =
      connectionState === 'reconnecting' ? MESSAGES.bannerReconnecting : MESSAGES.bannerConnecting;
  }

  // ---------------------------------------------------------------------------
  // ボードの変更
  // ---------------------------------------------------------------------------
  board.subscribe(() => {
    let pruned = false;
    for (const id of selection) {
      if (board.get(id) === undefined) {
        selection.delete(id);
        pruned = true;
      }
    }
    if (pruned) refreshUi();
    requestRender();
  });

  // ---------------------------------------------------------------------------
  // キーボード
  // ---------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === IME_PROCESS_KEY_CODE) return;
    if (textEditor.isOpen() || isTypingTarget(e.target)) return;

    if (e.code === SPACE_CODE) {
      e.preventDefault();
      if (!spaceHeld) {
        spaceHeld = true;
        canvas.classList.add(SPACE_PAN_CLASS);
      }
      return;
    }

    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        e.preventDefault();
        redo();
      }
      return;
    }
    if (mod || e.altKey) return;

    const tool = TOOL_SHORTCUTS[key];
    if (tool) {
      e.preventDefault();
      setTool(tool);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
      return;
    }
    if (e.key === 'Escape' && selection.size > 0) {
      setSelection([]);
    }
  });

  function releaseSpace(): void {
    spaceHeld = false;
    canvas.classList.remove(SPACE_PAN_CLASS);
  }

  window.addEventListener('keyup', (e) => {
    if (e.code !== SPACE_CODE) return;
    if (spaceHeld && !isTypingTarget(e.target)) e.preventDefault();
    releaseSpace();
  });
  window.addEventListener('blur', releaseSpace);

  // iOS Safari のページピンチズーム(独自ジェスチャーイベント)を抑止する
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  // ---------------------------------------------------------------------------
  // 接続
  // ---------------------------------------------------------------------------
  function resetForInit(objects: BoardObject[]): void {
    // 進行中の操作は古い状態に対するものなので破棄する(移動のローカル反映の巻き戻しを含む)
    input.cancel();
    textEditor.discard();
    ctx.remoteDrafts.clear();
    ctx.marquee = null;
    board.reset(objects);
    history.clear();
    setSelection([]);
  }

  function handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'init':
        resetForInit(msg.objects);
        break;
      case 'presence':
        participants = msg.count;
        refreshUi();
        break;
      case 'add':
      case 'update':
      case 'move':
      case 'remove':
      case 'clear':
        board.apply(msg);
        break;
      case 'draft:start':
        ctx.remoteDrafts.set(msg.object.id, { clientId: msg.clientId, stroke: msg.object });
        requestRender();
        break;
      case 'draft:points': {
        const draft = ctx.remoteDrafts.get(msg.id);
        if (!draft || draft.clientId !== msg.clientId) break;
        const room = LIMITS.maxPointsPerStroke - draft.stroke.points.length;
        if (room > 0) draft.stroke.points.push(...msg.points.slice(0, room));
        requestRender();
        break;
      }
      case 'draft:end': {
        const draft = ctx.remoteDrafts.get(msg.id);
        if (draft && draft.clientId === msg.clientId) ctx.remoteDrafts.delete(msg.id);
        requestRender();
        break;
      }
      case 'drafts:drop':
        for (const [id, draft] of ctx.remoteDrafts) {
          if (draft.clientId === msg.clientId) ctx.remoteDrafts.delete(id);
        }
        requestRender();
        break;
      case 'error':
        if (msg.message === 'room-full') {
          showToast(MESSAGES.errorRoomFull);
        } else {
          console.error('Server error:', msg.message);
          showToast(MESSAGES.errorGeneric);
        }
        // 拒否された操作はローカルにだけ反映済みなので、サーバーの状態を取り直して揃える
        if (msg.message === 'room-full' || msg.message === 'invalid-message') connection.resync();
        break;
    }
  }

  connection.onMessage(handleServerMessage);
  connection.onStateChange((state) => {
    connectionState = state;
    if (state !== 'connected') {
      // 切断中は編集を禁止する。送れない操作は破棄する
      input.cancel();
      textEditor.discard();
      ctx.remoteDrafts.clear();
      participants = 0;
      requestRender();
    }
    refreshUi();
  });

  canvas.dataset['tool'] = settings.tool;
  refreshUi();
  resizeCanvas();
  connection.start();
}

main();
