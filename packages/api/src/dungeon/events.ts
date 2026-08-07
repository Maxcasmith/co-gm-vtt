import { EventEmitter } from 'events';
import type { DungeonRoom } from 'shared';

// Dungeon-scoped event map. Add new event types here as dungeon features need them
// (e.g. enemy_discovered, trap_triggered) — each gets a payload shape and an emit call
// at its trigger site, same as room_entered below.
export interface DungeonEventMap {
  room_entered: { cid: string; room: DungeonRoom; characterName: string };
}

class DungeonEvents extends EventEmitter {
  override emit<K extends keyof DungeonEventMap>(event: K, payload: DungeonEventMap[K]): boolean {
    return super.emit(event, payload);
  }
  override on<K extends keyof DungeonEventMap>(event: K, listener: (payload: DungeonEventMap[K]) => void): this {
    return super.on(event, listener);
  }
}

export const dungeonEvents = new DungeonEvents();
