import { createBoard } from './board.ts';
import { connectRoom } from './net.ts';
import { renderToolbarState, setConnectionStatus, wireToolbar } from './toolbar.ts';

const ROOM_PARAM = 'room';
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ROOM_ID_LENGTH = 10;
const ROOM_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function createRoomId(): string {
  const bytes = new Uint8Array(ROOM_ID_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => ROOM_ID_ALPHABET[byte % ROOM_ID_ALPHABET.length]).join('');
}

/** Reads the room from `?room=`. When absent, creates one and writes it into the address bar. */
function resolveRoomId(): string {
  const url = new URL(location.href);
  const existing = url.searchParams.get(ROOM_PARAM);
  if (existing && ROOM_ID_PATTERN.test(existing)) return existing;
  const created = createRoomId();
  url.searchParams.set(ROOM_PARAM, created);
  history.replaceState(null, '', url);
  return created;
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

const roomId = resolveRoomId();
const canvas = requireElement<HTMLCanvasElement>('#board');
const stage = requireElement<HTMLElement>('#stage');

// The board and the network client reference each other. Both only call each other from callbacks,
// which run after both are assigned.
const net = connectRoom(roomId, {
  onSnapshot: (objects) => board.loadSnapshot(objects),
  onRemoteOp: (op) => board.applyRemote(op),
  onStatus: setConnectionStatus,
});

const board = createBoard({
  canvas,
  stage,
  send: (op) => net.send(op),
  onStateChange: renderToolbarState,
});

wireToolbar(board);
