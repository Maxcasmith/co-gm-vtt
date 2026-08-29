import { readFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { Dungeon } from 'shared';
import { slugifyTheme } from 'shared';
import { CAMPAIGNS_DIR, TILESETS_DIR, CREATURES_DIR, PROPS_DIR, getWorldMeta, loadDungeon } from './storage.ts';
import { SAVED_ADVENTURES_DIR, listSavedAdventures } from './adventures/storage.ts';
import { logError } from './logger.ts';

export interface ResourceUsageRef {
  kind: 'campaign' | 'saved-adventure';
  id: string;
  name: string;
}

export interface ResourceSlugs {
  tilesetSlug?: string;
  creatureSlugs: string[];
  propSlugs: string[];
}

// Same slug math as dungeon/creaturePortraits.ts's portraitSlug and dungeon/props.ts's propSlug —
// both are plain slugifyTheme(name) wrappers, so calling it directly here avoids exporting those
// internal helpers just for this cross-cutting scan.
export function collectResourceSlugs(dungeon: Dungeon): ResourceSlugs {
  const creatureSlugs = new Set<string>();
  const propSlugs = new Set<string>();
  for (const e of dungeon.entities) {
    if (e.type === 'creature' && e.statBlock) creatureSlugs.add(slugifyTheme(e.statBlock.name));
    else if (e.type === 'object' && e.spriteSrc && !e.followsId) propSlugs.add(slugifyTheme(e.name));
  }
  const tilesetSlug = dungeon.tilesetSlug ?? (dungeon.theme ? slugifyTheme(dungeon.theme) : undefined);
  return {
    ...(tilesetSlug ? { tilesetSlug } : {}),
    creatureSlugs: [...creatureSlugs],
    propSlugs: [...propSlugs],
  };
}

async function allDungeonRefs(): Promise<{ ref: ResourceUsageRef; slugs: ResourceSlugs }[]> {
  const out: { ref: ResourceUsageRef; slugs: ResourceSlugs }[] = [];

  if (existsSync(CAMPAIGNS_DIR)) {
    const entries = await readdir(CAMPAIGNS_DIR, { withFileTypes: true });
    await Promise.all(entries.filter(e => e.isDirectory()).map(async e => {
      const [meta, dungeon] = await Promise.all([getWorldMeta(e.name), loadDungeon(e.name)]);
      if (!meta || !dungeon) return;
      out.push({ ref: { kind: 'campaign', id: e.name, name: meta.name }, slugs: collectResourceSlugs(dungeon) });
    }));
  }

  for (const adv of await listSavedAdventures()) {
    try {
      const raw = await readFile(path.join(SAVED_ADVENTURES_DIR, adv.slug, 'dungeon.json'), 'utf-8');
      const dungeon = JSON.parse(raw) as Dungeon;
      out.push({ ref: { kind: 'saved-adventure', id: adv.slug, name: adv.name }, slugs: collectResourceSlugs(dungeon) });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logError('resourceUsage:allDungeonRefs', err);
    }
  }

  return out;
}

interface UsageOpts {
  excludeId?: string;
  excludeKind?: ResourceUsageRef['kind'];
}

function excluded(ref: ResourceUsageRef, opts?: UsageOpts): boolean {
  return ref.id === opts?.excludeId && ref.kind === opts?.excludeKind;
}

export async function findTilesetUsage(slug: string, opts?: UsageOpts): Promise<ResourceUsageRef[]> {
  const all = await allDungeonRefs();
  return all.filter(d => d.slugs.tilesetSlug === slug && !excluded(d.ref, opts)).map(d => d.ref);
}

export async function findCreatureUsage(slug: string, opts?: UsageOpts): Promise<ResourceUsageRef[]> {
  const all = await allDungeonRefs();
  return all.filter(d => d.slugs.creatureSlugs.includes(slug) && !excluded(d.ref, opts)).map(d => d.ref);
}

export async function findPropUsage(slug: string, opts?: UsageOpts): Promise<ResourceUsageRef[]> {
  const all = await allDungeonRefs();
  return all.filter(d => d.slugs.propSlugs.includes(slug) && !excluded(d.ref, opts)).map(d => d.ref);
}

export interface ResourceCleanupRequest {
  tiles?: boolean;
  creatures?: boolean;
  props?: boolean;
}

function describeUsage(usage: ResourceUsageRef[]): string {
  return usage.map(u => `${u.kind === 'campaign' ? 'campaign' : 'saved adventure'} "${u.name}"`).join(', ');
}

// Deletes the resources a campaign/saved-adventure's own dungeon uses, skipping (and reporting)
// anything still referenced elsewhere. `owner` identifies the campaign/adventure being deleted so
// its own reference to a resource never counts against itself.
export async function deleteUnusedResources(dungeon: Dungeon, requested: ResourceCleanupRequest, owner: UsageOpts): Promise<string[]> {
  const messages: string[] = [];
  const slugs = collectResourceSlugs(dungeon);

  if (requested.tiles && slugs.tilesetSlug) {
    const usage = await findTilesetUsage(slugs.tilesetSlug, owner);
    if (usage.length) messages.push(`Tileset "${slugs.tilesetSlug}" kept — still used in ${describeUsage(usage)}.`);
    else await rm(path.join(TILESETS_DIR, slugs.tilesetSlug), { recursive: true, force: true });
  }

  if (requested.creatures) {
    for (const slug of slugs.creatureSlugs) {
      const usage = await findCreatureUsage(slug, owner);
      if (usage.length) messages.push(`Creature "${slug}" kept — still used in ${describeUsage(usage)}.`);
      else await rm(path.join(CREATURES_DIR, slug), { recursive: true, force: true });
    }
  }

  if (requested.props) {
    for (const slug of slugs.propSlugs) {
      const usage = await findPropUsage(slug, owner);
      if (usage.length) messages.push(`Prop "${slug}" kept — still used in ${describeUsage(usage)}.`);
      else await rm(path.join(PROPS_DIR, slug), { recursive: true, force: true });
    }
  }

  return messages;
}
