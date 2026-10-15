import { LIMITS } from '../shared/limits';
import type { ClientMessage } from '../shared/protocol';
import type { BoardObject } from '../shared/types';

export type TimerHandle = ReturnType<typeof setTimeout>;

export type OpResult = { ok: true } | { ok: false; reason: 'room-full' | 'not-joined' | 'invalid-message' };

export type RoomStoreOptions = {
  emptyRoomTtlMs: number;
  maxObjects: number;
  setTimer: (fn: () => void, ms: number) => TimerHandle;
  clearTimer: (h: TimerHandle) => void;
};

export type RoomStore = {
  join(roomId: string, clientId: string): BoardObject[];
  leave(clientId: string): { roomId: string; remaining: number } | null;
  apply(clientId: string, msg: ClientMessage): OpResult;
  snapshot(roomId: string): BoardObject[];
  clientsIn(roomId: string): string[];
  roomOf(clientId: string): string | null;
};

type Room = {
  /** Map の挿入順が重なり順 */
  objects: Map<string, BoardObject>;
  clients: Set<string>;
  timer: TimerHandle | null;
};

function translate(obj: BoardObject, dx: number, dy: number): BoardObject {
  if (obj.kind === 'stroke') {
    return { ...obj, points: obj.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy, p: pt.p })) };
  }
  return { ...obj, x: obj.x + dx, y: obj.y + dy };
}

function isCoordinate(v: number): boolean {
  return Math.abs(v) <= LIMITS.maxCoordinate;
}

/** 移動後の座標がすべて LIMITS.maxCoordinate の範囲内か(Infinity・NaN も弾く) */
function hasValidCoordinates(obj: BoardObject): boolean {
  if (obj.kind === 'stroke') return obj.points.every((pt) => isCoordinate(pt.x) && isCoordinate(pt.y));
  return isCoordinate(obj.x) && isCoordinate(obj.y);
}

export function createRoomStore(opts: RoomStoreOptions): RoomStore {
  const rooms = new Map<string, Room>();
  const clientRoom = new Map<string, string>();

  function copyObjects(room: Room): BoardObject[] {
    return Array.from(room.objects.values(), (obj) => structuredClone(obj));
  }

  function join(roomId: string, clientId: string): BoardObject[] {
    const previous = clientRoom.get(clientId);
    if (previous !== undefined && previous !== roomId) {
      // 別ルームに居たままにしない
      leave(clientId);
    }
    let room = rooms.get(roomId);
    if (room === undefined) {
      room = { objects: new Map(), clients: new Set(), timer: null };
      rooms.set(roomId, room);
    }
    if (room.timer !== null) {
      opts.clearTimer(room.timer);
      room.timer = null;
    }
    room.clients.add(clientId);
    clientRoom.set(clientId, roomId);
    return copyObjects(room);
  }

  function leave(clientId: string): { roomId: string; remaining: number } | null {
    const roomId = clientRoom.get(clientId);
    if (roomId === undefined) return null;
    clientRoom.delete(clientId);
    const room = rooms.get(roomId);
    if (room === undefined) return null;
    room.clients.delete(clientId);
    const remaining = room.clients.size;
    if (remaining === 0 && room.timer === null) {
      room.timer = opts.setTimer(() => {
        const current = rooms.get(roomId);
        if (current === room && room.clients.size === 0) {
          rooms.delete(roomId);
        }
      }, opts.emptyRoomTtlMs);
    }
    return { roomId, remaining };
  }

  function apply(clientId: string, msg: ClientMessage): OpResult {
    const roomId = clientRoom.get(clientId);
    const room = roomId === undefined ? undefined : rooms.get(roomId);
    if (room === undefined) return { ok: false, reason: 'not-joined' };
    const objects = room.objects;

    switch (msg.type) {
      case 'add': {
        const fresh = new Map<string, BoardObject>();
        for (const obj of msg.objects) {
          if (!objects.has(obj.id) && !fresh.has(obj.id)) {
            fresh.set(obj.id, obj);
          }
        }
        if (objects.size + fresh.size > opts.maxObjects) {
          return { ok: false, reason: 'room-full' };
        }
        for (const [id, obj] of fresh) {
          objects.set(id, structuredClone(obj));
        }
        return { ok: true };
      }
      case 'update': {
        if (objects.has(msg.object.id)) {
          // 既存キーへの set は挿入順(重なり順)を保つ
          objects.set(msg.object.id, structuredClone(msg.object));
        }
        return { ok: true };
      }
      case 'move': {
        // 1つでも範囲外になるなら移動全体を拒否する(一部だけ動かさない)
        const moved: Array<[string, BoardObject]> = [];
        for (const id of msg.ids) {
          const obj = objects.get(id);
          if (obj === undefined) continue;
          const next = translate(obj, msg.dx, msg.dy);
          if (!hasValidCoordinates(next)) return { ok: false, reason: 'invalid-message' };
          moved.push([id, next]);
        }
        for (const [id, next] of moved) objects.set(id, next);
        return { ok: true };
      }
      case 'remove': {
        for (const id of msg.ids) {
          objects.delete(id);
        }
        return { ok: true };
      }
      case 'clear': {
        objects.clear();
        return { ok: true };
      }
      case 'join':
      case 'draft:start':
      case 'draft:points':
      case 'draft:end':
        return { ok: true };
    }
  }

  function snapshot(roomId: string): BoardObject[] {
    const room = rooms.get(roomId);
    return room === undefined ? [] : copyObjects(room);
  }

  function clientsIn(roomId: string): string[] {
    const room = rooms.get(roomId);
    return room === undefined ? [] : Array.from(room.clients);
  }

  function roomOf(clientId: string): string | null {
    return clientRoom.get(clientId) ?? null;
  }

  return { join, leave, apply, snapshot, clientsIn, roomOf };
}
