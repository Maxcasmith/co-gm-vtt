import { randomUUID } from 'crypto';
import type { Dungeon } from 'shared';
import type { StoryProviderAdapter } from '../providers/index.ts';
import { fetchManifest } from './manifest.ts';
import { generateGrid } from './generator.ts';
import { placeEntities } from './placer.ts';

export async function generateDungeon(
  name: string,
  dungeonType: string,
  adapter: StoryProviderAdapter,
): Promise<Dungeon> {
  const manifest = await fetchManifest(name, dungeonType, adapter);
  const { cells, rooms } = generateGrid(manifest);
  const entities = placeEntities(rooms, manifest);

  return {
    id: randomUUID(),
    name,
    width: 50,
    height: 50,
    cells,
    rooms,
    entities,
  };
}
