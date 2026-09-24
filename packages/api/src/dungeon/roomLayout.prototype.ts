/**
 * Prototype runner for pass 3 (ASCII room layout). Reusable, deliberately standalone:
 *
 *   npx tsx src/dungeon/roomLayout.prototype.ts <campaign-slug> "<room name>"
 *   npx tsx src/dungeon/roomLayout.prototype.ts problem-at-gas-pump-6 "Diner Dining Room"
 *
 * Takes a dungeon that already exists on disk and re-furnishes ONE of its rooms, so a run costs a
 * single small model call — no manifest, no creatures, no tilesets, no images, nothing written back.
 * The whole point is to find out whether the model can hold grid alignment at this room's real
 * width before we spend a full dungeon finding out.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Dungeon, DungeonRoom, PropCatalogue, PropSpec } from 'shared';
import { WALL_MOUNTED_CATEGORIES, propSizeXY } from 'shared';
import { getConfig } from '../storage.ts';
import { getFeatureProvider } from '../providers/index.ts';
import { propTargetFor } from './propDressing.ts';
import { buildLayoutPrompt, buildLegend, findThresholds, parseLayout, renderPlaced, renderRoomMask } from './roomLayout.ts';

const STORAGE = path.join(process.cwd(), 'storage');

async function loadDungeon(slug: string): Promise<Dungeon> {
  const dir = path.join(STORAGE, 'campaigns', slug, 'dungeons');
  const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
  if (!files.length) throw new Error(`no dungeon json under ${dir}`);
  return JSON.parse(await readFile(path.join(dir, files[0]!), 'utf8')) as Dungeon;
}

/** The props this room already holds, with dimensions from the catalogue bucket. */
function propsInRoom(dungeon: Dungeon, room: DungeonRoom, catalogue: PropCatalogue): PropSpec[] {
  const nouns = new Set(
    dungeon.entities
      .filter(e => e.type === 'object' && e.x >= room.x && e.x < room.x + room.width && e.y >= room.y && e.y < room.y + room.height)
      .map(e => e.name),
  );
  const specs: PropSpec[] = [];
  for (const tones of Object.values(catalogue)) {
    for (const categories of Object.values(tones ?? {})) {
      for (const [category, entries] of Object.entries(categories ?? {})) {
        for (const [noun, entry] of Object.entries(entries)) {
          // Wall-mounted objects are excluded outright: overhead they read as a sign lying flat on
          // the floor, and they cost an image slot, prompt tokens and floor space to look wrong.
          if (!nouns.has(noun) || WALL_MOUNTED_CATEGORIES.includes(category as PropSpec['category'])) continue;
          specs.push({
            noun,
            category: category as PropSpec['category'],
            description: entry.description ?? noun.replace(/-/g, ' '),
            sizeXY: propSizeXY(entry) ?? [1, 1],
          });
        }
      }
    }
  }
  return specs;
}

async function main(): Promise<void> {
  const [slug, roomName] = process.argv.slice(2);
  if (!slug || !roomName) throw new Error('usage: roomLayout.prototype.ts <campaign-slug> "<room name>"');

  const dungeon = await loadDungeon(slug);
  const room = dungeon.rooms.find(r => r.name === roomName);
  if (!room) throw new Error(`no room "${roomName}" — have: ${dungeon.rooms.map(r => r.name).join(', ')}`);

  const catalogue = JSON.parse(await readFile(path.join(STORAGE, 'prop-catalogue.json'), 'utf8')) as PropCatalogue;
  const specs = propsInRoom(dungeon, room, catalogue);
  if (!specs.length) throw new Error(`no catalogued props found in "${roomName}"`);

  // Everything non-prop that already stands in this room stays where it is — the layout call is
  // told those cells are gone rather than being allowed to furnish over a creature or the stairs.
  const blocked = new Set(
    dungeon.entities
      .filter(e => e.type !== 'object' && e.type !== 'door')
      .map(e => `${e.x},${e.y}`),
  );
  const thresholds = findThresholds(room, dungeon.cells);
  const mask = renderRoomMask(room, dungeon.cells, thresholds, blocked);
  const legend = buildLegend(specs);
  const target = propTargetFor(room, dungeon.cells);
  const prompt = buildLayoutPrompt(room, mask, legend, room.description ?? '', 'modern setting, horror tone', target);

  console.log(`room "${room.name}" ${room.width}x${room.height} cells (${room.width * 5}x${room.height * 5}ft), ${specs.length} prop types, ${thresholds.size} threshold cells, target ${target} objects`);
  console.log(`prompt ${prompt.length} chars\n`);
  console.log('MASK SENT:');
  console.log(mask.rows.map((r, i) => `${String(i).padStart(2, '0')}|${r}`).join('\n'));

  const config = await getConfig();
  const adapter = getFeatureProvider(config, 'dungeonGeneration');
  const started = Date.now();
  const raw = await adapter.stream(prompt, () => {});
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(cleaned) as { furniture?: unknown; facing?: unknown };

  console.log(`\nreply in ${elapsed}s, ${raw.length} chars\n`);
  console.log('FURNITURE RETURNED:');
  console.log((Array.isArray(parsed.furniture) ? parsed.furniture : []).join('\n'));
  console.log('\nFACING RETURNED:');
  console.log((Array.isArray(parsed.facing) ? parsed.facing : []).join('\n'));

  const result = parseLayout(parsed, room, mask, legend);
  console.log('\nACCEPTED (re-rendered from the parsed props):');
  console.log(renderPlaced(mask, result.props, room, legend));

  console.log('\nLEGEND:');
  for (const [ch, spec] of legend) console.log(`  ${ch} = ${spec.noun} (${spec.sizeXY[0]}x${spec.sizeXY[1]} cells)`);

  const cells = result.props.reduce((n, p) => n + p.width * p.height, 0);
  const floor = mask.rows.join('').split('').filter(c => c === '_').length;
  console.log(`\nRESULT: ${result.props.length} objects over ${cells} cells (${Math.round((100 * cells) / floor)}% of ${floor} free floor cells)`);
  console.log(`rejected rows: ${result.rejected.length}${result.rejected.length ? '' : ' — grid alignment held'}`);
  for (const r of result.rejected) console.log(`  row ${r.row}: ${r.reason}`);
  const unused = [...legend.values()].filter(s => !result.props.some(p => p.noun === s.noun)).map(s => s.noun);
  if (unused.length) console.log(`never placed: ${unused.join(', ')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
