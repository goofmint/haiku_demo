import { WebSocket } from 'ws';
import { applyOp, type ObjectMap } from '../src/shared/apply.ts';
import type { Op, ServerMessage } from '../src/shared/model.ts';

export interface Room {
  id: string;
  objects: ObjectMap;
  members: Set<WebSocket>;
}

export type RoomRegistry = Map<string, Room>;

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidRoomId(id: string): boolean {
  return ROOM_ID_PATTERN.test(id);
}

export function joinRoom(rooms: RoomRegistry, roomId: string, socket: WebSocket): Room {
  const room = rooms.get(roomId) ?? { id: roomId, objects: new Map(), members: new Set() };
  rooms.set(roomId, room);
  room.members.add(socket);
  return room;
}

export function leaveRoom(rooms: RoomRegistry, room: Room, socket: WebSocket): void {
  room.members.delete(socket);
  // Drop the board from memory once nobody is looking at it.
  if (room.members.size === 0) rooms.delete(room.id);
}

export function snapshotMessage(room: Room): string {
  const message: ServerMessage = { type: 'snapshot', objects: [...room.objects.values()] };
  return JSON.stringify(message);
}

/** Applies the op to the room state and forwards it to every other member. */
export function handleOp(room: Room, sender: WebSocket, op: Op): void {
  applyOp(room.objects, op);
  const message: ServerMessage = { type: 'op', op };
  const payload = JSON.stringify(message);
  for (const member of room.members) {
    if (member !== sender && member.readyState === WebSocket.OPEN) member.send(payload);
  }
}
