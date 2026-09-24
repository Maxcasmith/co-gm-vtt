/**
 * Re-furnishes an existing dungeon with pass 3 (ASCII room layout), in place. Reusable:
 *
 *   npx tsx src/dungeon/refurnish.ts <path/to/dungeon.json>
 *   npx tsx src/dungeon/refurnish.ts storage/saved-adventures/problem-at-gas-pump-6/dungeons/<id>.json
 *
 * Keeps each room's existing prop mix and counts — only the arrangement is redone — so it costs one
 * small text call per room and no images. The genre is read from the world.json beside the
 * dungeons/ folder.
 *
 * The backup goes to storage/backups/, deliberately NOT beside the file: loadDungeons parses every
 * file in a dungeons/ folder with no extension filter, and cloning an adventure copies the folder —
 * a .bak left there would load as a second dungeon with the same id.
 *
 * Props whose noun is no longer in the catalogue (the wall-mounted ones removed from it) are dropped
 * rather than carried over, since they have no size to lay out.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CampaignGenre, Dungeon, PropSpec, RoomProp } from 'shared';
import { propSizeXY } from 'shared';
import { getConfig } from '../storage.ts';
import { getFeatureProvider } from '../providers/index.ts';
import { readPropBucket } from './propCatalogue.ts';
import { assignPropSpriteSrcs } from './props.ts';
import { furnishRooms } from './roomLayout.ts';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('usage: refurnish.ts <path/to/dungeon.json>');

  const dungeon = JSON.parse(await readFile(file, 'utf8')) as Dungeon;
  const world = JSON.parse(await readFile(path.join(path.dirname(file), '..', 'world.json'), 'utf8')) as { genre?: CampaignGenre };
  const genre = world.genre;
  if (!genre) throw new Error('world.json has no genre — prop sprites are bucketed by genre, nothing to point at');

  const bucket = await readPropBucket(genre);
  const specs = new Map<string, PropSpec>();
  for (const [category, entries] of Object.entries(bucket)) {
    for (const [noun, entry] of Object.entries(entries ?? {})) {
      const sizeXY = propSizeXY(entry);
      if (sizeXY) specs.set(noun, { noun, category: category as PropSpec['category'], description: entry.description ?? noun, sizeXY });
    }
  }

  const oldProps = dungeon.entities.filter(e => e.type === 'object' && !e.followsId);
  const others = dungeon.entities.filter(e => !(e.type === 'object' && !e.followsId));

  const byRoom = new Map<string, RoomProp[]>();
  const dropped = new Set<string>();
  for (const room of dungeon.rooms) {
    const counts = new Map<string, number>();
    for (const e of oldProps) {
      if (e.x < room.x || e.x >= room.x + room.width || e.y < room.y || e.y >= room.y + room.height) continue;
      if (!specs.has(e.name)) { dropped.add(e.name); continue; }
      counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
    }
    if (counts.size) byRoom.set(room.name, [...counts].map(([noun, count]) => ({ noun, count, zone: 'floor' })));
  }

  const plan = { props: [...specs.values()].filter(s => [...byRoom.values()].flat().some(r => r.noun === s.noun)), byRoom };
  const descriptions = new Map(dungeon.rooms.map(r => [r.name, r.description ?? '']));
  const adapter = getFeatureProvider(await getConfig(), 'dungeonGeneration');

  console.log(`${dungeon.name}: ${oldProps.length} old props across ${byRoom.size} rooms, ${plan.props.length} types, genre ${genre.setting}/${genre.tone}`);
  if (dropped.size) console.log(`dropping (no longer catalogued): ${[...dropped].join(', ')}`);
  const started = Date.now();
  const props = await furnishRooms(dungeon.rooms, plan, dungeon.cells, others, adapter, descriptions, genre);
  console.log(`laid out in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  dungeon.entities = [...others, ...props];
  assignPropSpriteSrcs(dungeon.entities, genre);

  const backupDir = path.join(process.cwd(), 'storage', 'backups');
  await mkdir(backupDir, { recursive: true });
  const backup = path.join(backupDir, `${path.basename(file, '.json')}.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await copyFile(file, backup);
  await writeFile(file, JSON.stringify(dungeon, null, 2));

  for (const room of dungeon.rooms) {
    const inRoom = props.filter(p => p.x >= room.x && p.x < room.x + room.width && p.y >= room.y && p.y < room.y + room.height);
    const before = byRoom.get(room.name)?.reduce((n, r) => n + r.count, 0) ?? 0;
    if (before || inRoom.length) console.log(`  ${room.name.padEnd(26)} ${String(before).padStart(3)} -> ${inRoom.length}`);
  }
  console.log(`\n${oldProps.length} -> ${props.length} props. Backup: ${backup}`);
}

main().catch(err => { console.error(err); process.exit(1); });
