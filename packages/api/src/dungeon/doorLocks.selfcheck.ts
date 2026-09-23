// Standalone check for the door-lock feature end to end — no test framework in this repo, so this
// is the one runnable check: `tsx src/dungeon/doorLocks.selfcheck.ts` from packages/api. Covers
// the three places a lock/key gets resolved or invalidated: manifest.ts's resolveDoorLocks (per-room
// validation against the manifest's own loot), buildingLayout.ts's lockFor (cross-room conflict
// resolution, carried through real geometry), and dungeon/index.ts's resolveDoorState (name -> real
// placed entity id).
import { resolveDoorLocks } from './manifest.ts';
import type { DungeonManifest, ManifestRoom } from './manifest.ts';
import { generateBuildingLayout } from './buildingLayout.ts';
import { resolveDoorState } from './index.ts';

// ── 1. resolveDoorLocks: per-room validation/downgrade ─────────────────────────────────────────
{
  const rooms: ManifestRoom[] = [
    {
      name: 'Entrance', size: 'medium', role: 'entrance', connectsTo: ['Vault', 'Broken Vault', 'Nowhere'],
      doors: [
        { toRoom: 'Vault', state: 'locked', keyName: 'Vault Key' },
        { toRoom: 'Broken Vault', state: 'locked', keyName: 'Nonexistent Item' },
        { toRoom: 'Nowhere', state: 'closed' }, // dangling room reference
      ],
    },
    { name: 'Vault', size: 'small', connectsTo: ['Entrance'] },
    { name: 'Broken Vault', size: 'small', connectsTo: ['Entrance'] },
    { name: 'Storage', size: 'small', loot: [{ name: 'Vault Key', hideDC: 18, contents: ['a small brass key'] }] },
  ];

  const fixed = resolveDoorLocks(rooms);
  const entrance = fixed.find(r => r.name === 'Entrance')!;

  const vaultDoor = entrance.doors!.find(d => d.toRoom === 'Vault');
  if (vaultDoor?.state !== 'locked' || vaultDoor.keyName !== 'Vault Key') {
    throw new Error(`expected Vault door to stay locked with its real key, got: ${JSON.stringify(vaultDoor)}`);
  }
  if (typeof vaultDoor.lockpickDC !== 'number') throw new Error(`expected every locked door to get a lockpickDC even when the manifest omitted one, got: ${JSON.stringify(vaultDoor)}`);

  const brokenDoor = entrance.doors!.find(d => d.toRoom === 'Broken Vault');
  if (brokenDoor?.state !== 'closed' || brokenDoor.keyName || brokenDoor.lockpickDC) {
    throw new Error(`expected a lock with no real key to downgrade to closed with no keyName/lockpickDC, got: ${JSON.stringify(brokenDoor)}`);
  }

  if (entrance.doors!.some(d => d.toRoom === 'Nowhere')) {
    throw new Error('a door pointing at a room that doesn\'t exist should be dropped entirely');
  }

  const key = fixed.find(r => r.name === 'Storage')!.loot!.find(l => l.name === 'Vault Key')!;
  if (key.hideDC !== -99) throw new Error(`expected a real key's hideDC forced to -99, got ${key.hideDC}`);

  console.log('resolveDoorLocks: OK — valid lock survives with a lockpickDC, unkeyed lock downgrades, dangling edge dropped, key hideDC forced to -99.');
}

// ── 2. lockFor + generateBuildingLayout: cross-room conflict, real geometry ─────────────────────
{
  const rooms: ManifestRoom[] = resolveDoorLocks([
    { name: 'Entrance', size: 'medium', role: 'entrance', connectsTo: ['Ambiguous', 'Plain'], doors: [{ toRoom: 'Ambiguous', state: 'open' }] },
    { name: 'Ambiguous', size: 'small', connectsTo: ['Entrance'], doors: [{ toRoom: 'Entrance', state: 'locked', keyName: 'Side Key' }], loot: [{ name: 'Side Key', hideDC: 20 }] },
    { name: 'Plain', size: 'small', connectsTo: ['Entrance'] },
  ]);
  const manifest: DungeonManifest = { rooms, structureType: 'building', theme: 'medieval', questChain: [], illumination: 1, materials: [] };
  const { doors } = generateBuildingLayout(manifest, { width: 40, height: 40 });

  // Entrance<->Ambiguous: Entrance said 'open', Ambiguous said 'locked' — the more restrictive
  // side must win regardless of which room happened to declare it.
  const ambiguousDoor = doors!.find(d => d.keyName === 'Side Key' || d.doorState === 'locked');
  if (!ambiguousDoor || ambiguousDoor.doorState !== 'locked' || ambiguousDoor.keyName !== 'Side Key') {
    throw new Error(`expected the locked declaration to win over the conflicting open one, got: ${JSON.stringify(doors)}`);
  }
  if (typeof ambiguousDoor.lockpickDC !== 'number') throw new Error(`expected lockpickDC to survive from resolveDoorLocks through real geometry, got: ${JSON.stringify(ambiguousDoor)}`);

  // Entrance<->Plain: neither side declared anything — must come through as a plain, unlocked
  // doorway (no doorState/keyName at all), same as before this feature existed.
  const plainDoors = doors!.filter(d => d !== ambiguousDoor);
  if (plainDoors.some(d => d.doorState || d.keyName)) {
    throw new Error(`expected an undeclared edge to carry no lock metadata at all, got: ${JSON.stringify(plainDoors)}`);
  }

  console.log('lockFor/generateBuildingLayout: OK — conflicting declarations resolve to the more restrictive state, undeclared edges stay plain.');
}

// ── 3. resolveDoorState: name -> real placed entity id ──────────────────────────────────────────
{
  const lootIdByName = new Map([['Vault Key', 'entity-123']]);
  const base = { x: 0, y: 0, width: 1, height: 1 };

  const locked = resolveDoorState({ ...base, doorState: 'locked', keyName: 'Vault Key' }, lootIdByName);
  if (locked.doorState !== 'locked' || locked.requiresKeyId !== 'entity-123') {
    throw new Error(`expected a resolvable key to produce a real requiresKeyId, got: ${JSON.stringify(locked)}`);
  }
  if (typeof locked.lockpickDC !== 'number') throw new Error(`expected a default lockpickDC when the DoorRect didn't carry one, got: ${JSON.stringify(locked)}`);

  const withOwnDC = resolveDoorState({ ...base, doorState: 'locked', keyName: 'Vault Key', lockpickDC: 22 }, lootIdByName);
  if (withOwnDC.lockpickDC !== 22) throw new Error(`expected an explicit lockpickDC to be preserved, not overridden by the default, got: ${JSON.stringify(withOwnDC)}`);

  const unresolvable = resolveDoorState({ ...base, doorState: 'locked', keyName: 'Nothing Here' }, lootIdByName);
  if (unresolvable.doorState !== 'closed' || unresolvable.requiresKeyId || unresolvable.lockpickDC) {
    throw new Error(`expected an unresolvable key to downgrade to closed with no requiresKeyId/lockpickDC, got: ${JSON.stringify(unresolvable)}`);
  }

  const plain = resolveDoorState({ ...base }, lootIdByName);
  if (plain.doorState !== 'closed' || plain.requiresKeyId) {
    throw new Error(`expected an undeclared door to default to closed, got: ${JSON.stringify(plain)}`);
  }

  console.log('resolveDoorState: OK — resolvable key links to the real entity id with a lockpickDC (default or explicit), unresolvable key downgrades, undeclared defaults to closed.');
}

console.log('doorLocks selfcheck: all assertions passed');
