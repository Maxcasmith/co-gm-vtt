// Held creatures end to end: `tsx src/dungeon/spawns.selfcheck.ts` from packages/api. Covers
// manifest.ts's resolveAppearances (which stage a creature waits for) and placer.ts's
// collectPendingSpawns/spawnPending (holding it off the map, then bringing it on).
import type { Dungeon, DungeonQuestStage, EnemyStatBlock } from 'shared';
import { resolveAppearances, type DungeonManifest, type ManifestRoom } from './manifest.ts';
import { collectPendingSpawns, placeEntities, spawnPending } from './placer.ts';

const stat = (name: string, extra: Partial<EnemyStatBlock> = {}): EnemyStatBlock => ({
  id: name, name, cr: 1, hp: 10, ac: 12, speed: 30, stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, attacks: [], ...extra,
});

const chain: DungeonQuestStage[] = [
  { id: 'reach', name: 'Reach', description: '- go', trigger: { kind: 'enter_room', roomName: 'Lobby' } },
  { id: 'signal', name: 'Signal', description: '- find', trigger: { kind: 'discover_entity', entityName: 'Radio' } },
  { id: 'boss', name: 'Boss', description: '- kill', trigger: { kind: 'defeat_boss' } },
];

const manifestRooms: ManifestRoom[] = [
  { name: 'Street', size: 'medium', role: 'entrance' },
  {
    name: 'Steps', size: 'medium', creatures: [
      // The storm bug: the boss sat here from turn one. Must be held for 'boss' whatever was written.
      { ...stat('Gatekeeper', { isBoss: true }), appears: 'reach' },
      { ...stat('Resident'), appears: 'signal' },
      { ...stat('Walker'), appears: 'nonsense-stage' },
      { ...stat('Sleeper'), appears: 'reach' },
    ],
  },
];

const resolved = resolveAppearances(manifestRooms, chain);
const appears = (name: string) => resolved[1]!.creatures!.find(c => c.name === name)?.appears;
if (appears('Gatekeeper') !== 'boss') throw new Error('a defeat_boss stage must always hold its boss until that stage');
if (appears('Resident') !== 'signal') throw new Error('a valid later stage must be kept');
if (appears('Walker') !== undefined) throw new Error('an unknown stage id must fall back to present from the start');
if (appears('Sleeper') !== undefined) throw new Error('the first stage is active from the start — no hold');

const rooms = [
  { id: 'street', name: 'Street', x: 0, y: 0, width: 4, height: 4, role: 'entrance' as const },
  { id: 'steps', name: 'Steps', x: 5, y: 0, width: 4, height: 4 },
];
const cells = Array.from({ length: 4 }, () => new Array(10).fill(1));
const manifest: DungeonManifest = { rooms: resolved, structureType: 'building', theme: 'modern', questChain: chain, illumination: 1, materials: [] };

const placed = placeEntities(rooms, manifest, cells);
const placedNames = placed.filter(e => e.type === 'creature').map(e => e.name).sort();
if (placedNames.join() !== 'Sleeper,Walker') throw new Error(`only creatures with no hold are placed, got ${placedNames}`);

const pendingSpawns = collectPendingSpawns(rooms, manifest);
if (pendingSpawns.length !== 2 || pendingSpawns.some(p => p.roomId !== 'steps')) throw new Error('held creatures must be pending in their own room');

const dungeon: Dungeon = { id: 'd', name: 'D', width: 10, height: 4, cells, rooms, entities: placed, questChain: chain, pendingSpawns };
if (spawnPending(dungeon, 'reach').length !== 0) throw new Error('a stage with nothing held spawns nothing');
const arrived = spawnPending(dungeon, 'boss');
if (arrived.length !== 1 || arrived[0]!.name !== 'Gatekeeper') throw new Error('the boss must arrive when its stage opens');
const boss = arrived[0]!;
if (boss.x < 5 || boss.x >= 9) throw new Error('a spawn must land inside its room');
if (placed.some(e => e !== boss && e.x === boss.x && e.y === boss.y)) throw new Error('a spawn must not share a cell with another entity');
if (dungeon.pendingSpawns?.length !== 1 || dungeon.pendingSpawns[0]!.statBlock.name !== 'Resident') throw new Error('spawned creatures leave pendingSpawns; the rest stay');

console.log('spawns selfcheck passed');
