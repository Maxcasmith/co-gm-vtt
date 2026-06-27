import { randomUUID } from 'crypto';
import type { DungeonRoom, DungeonEntity } from 'shared';
import type { DungeonManifest } from './manifest.ts';

function area(room: DungeonRoom): number {
  return room.width * room.height;
}

export function placeEntities(rooms: DungeonRoom[], manifest: DungeonManifest | null): DungeonEntity[] {
  if (rooms.length === 0) return [];

  const entities: DungeonEntity[] = [];
  const manifestRooms = manifest?.rooms ?? [];

  // Largest room = boss; smallest third = loot caches; rest = patrols
  const byArea = [...rooms].sort((a, b) => area(b) - area(a));
  const bossRoom = byArea[0]!;
  const lootRooms = new Set(byArea.slice(Math.floor(byArea.length * 0.65)).map(r => r.id));

  for (const room of rooms) {
    const hints = manifestRooms.find(mr => mr.name === room.name);
    // Place at room center; loot offset 1 cell right so they don't overlap
    const cx = room.x + Math.floor(room.width / 2);
    const cy = room.y + Math.floor(room.height / 2);

    const creatureName = hints?.creatures?.[0] ?? (room.id === bossRoom.id ? 'Boss' : 'Guard');
    const isLoot = lootRooms.has(room.id);

    if (!isLoot || hints?.creatures?.length) {
      entities.push({ id: randomUUID(), type: 'creature', x: cx, y: cy, name: creatureName });
    }

    const lootName = hints?.loot?.[0] ?? 'Chest';
    if (isLoot || hints?.loot?.length) {
      entities.push({ id: randomUUID(), type: 'loot', x: Math.min(cx + 1, room.x + room.width - 1), y: cy, name: lootName });
    }
  }

  return entities;
}
