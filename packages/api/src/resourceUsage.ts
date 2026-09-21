import path from 'path';
import type { Dungeon } from 'shared';
import { slugifyTheme } from 'shared';
import { CAMPAIGNS_DIR, TILESETS_DIR, CREATURES_DIR, PROPS_DIR, getWorldMeta, loadDungeons } from './storage.ts';
import { getTextStore, getMediaStore } from './storage/index.ts';
import { SAVED_ADVENTURES_DIR, listSavedAdventures } from './adventures/storage.ts';
import { logError } from './logger.ts';

export interface ResourceUsageRef {
  kind: 'campaign' | 'saved-adventure';
  id: string;
  name: string;
}

export interface ResourceSlugs {
  /** The tileset this dungeon owns — the only one deleting it may ever remove. */
  tilesetSlug?: string;
  /** Tilesets this dungeon borrows single materials from (Dungeon.materialSources) but doesn't own.
   * Counted as usage so a borrowed tileset survives its original dungeon being deleted, never
   * deleted on this dungeon's behalf. */
  borrowedTilesetSlugs: string[];
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
  const borrowed = new Set(Object.values(dungeon.materialSources ?? {}));
  borrowed.delete(tilesetSlug ?? '');
  return {
    ...(tilesetSlug ? { tilesetSlug } : {}),
    borrowedTilesetSlugs: [...borrowed],
    creatureSlugs: [...creatureSlugs],
    propSlugs: [...propSlugs],
  };
}

async function allDungeonRefs(): Promise<{ ref: ResourceUsageRef; slugs: ResourceSlugs }[]> {
  const out: { ref: ResourceUsageRef; slugs: ResourceSlugs }[] = [];

  const campaignSlugs = await getTextStore().list(CAMPAIGNS_DIR);
  await Promise.all(campaignSlugs.map(async slug => {
    // EVERY dungeon the campaign has, not just the first. Dungeons are kept after the party leaves
    // (so a return visit re-opens the same map), so a campaign routinely holds several — scanning
    // only ds[0] would report art used by the others as unused and collect it out from under them.
    const [meta, dungeons] = await Promise.all([getWorldMeta(slug), loadDungeons(slug)]);
    if (!meta) return;
    for (const dungeon of dungeons) {
      out.push({ ref: { kind: 'campaign', id: slug, name: meta.name }, slugs: collectResourceSlugs(dungeon) });
    }
  }));

  for (const adv of await listSavedAdventures()) {
    try {
      const raw = await getTextStore().get(path.join(SAVED_ADVENTURES_DIR, adv.slug, 'dungeon.json'));
      if (raw === null) continue;
      const dungeon = JSON.parse(raw) as Dungeon;
      out.push({ ref: { kind: 'saved-adventure', id: adv.slug, name: adv.name }, slugs: collectResourceSlugs(dungeon) });
    } catch (err) {
      logError('resourceUsage:allDungeonRefs', err);
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

// A campaign contributes one entry per stored dungeon, so the same campaign can match a resource
// several times — collapse those so "still used in X, X, X" reads as "still used in X".
function distinctRefs(refs: ResourceUsageRef[]): ResourceUsageRef[] {
  const seen = new Map<string, ResourceUsageRef>();
  for (const ref of refs) seen.set(`${ref.kind}:${ref.id}`, ref);
  return [...seen.values()];
}

export async function findTilesetUsage(slug: string, opts?: UsageOpts): Promise<ResourceUsageRef[]> {
  const all = await allDungeonRefs();
  return distinctRefs(all
    .filter(d => (d.slugs.tilesetSlug === slug || d.slugs.borrowedTilesetSlugs.includes(slug)) && !excluded(d.ref, opts))
    .map(d => d.ref));
}

export async function findCreatureUsage(slug: string, opts?: UsageOpts): Promise<ResourceUsageRef[]> {
  const all = await allDungeonRefs();
  return distinctRefs(all.filter(d => d.slugs.creatureSlugs.includes(slug) && !excluded(d.ref, opts)).map(d => d.ref));
}

export async function findPropUsage(slug: string, opts?: UsageOpts): Promise<ResourceUsageRef[]> {
  const all = await allDungeonRefs();
  return distinctRefs(all.filter(d => d.slugs.propSlugs.includes(slug) && !excluded(d.ref, opts)).map(d => d.ref));
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
    else await getMediaStore().deletePrefix(path.join(TILESETS_DIR, slugs.tilesetSlug));
  }

  if (requested.creatures) {
    for (const slug of slugs.creatureSlugs) {
      const usage = await findCreatureUsage(slug, owner);
      if (usage.length) messages.push(`Creature "${slug}" kept — still used in ${describeUsage(usage)}.`);
      else {
        const dir = path.join(CREATURES_DIR, slug);
        await Promise.all([getTextStore().deletePrefix(dir), getMediaStore().deletePrefix(dir)]);
      }
    }
  }

  if (requested.props) {
    for (const slug of slugs.propSlugs) {
      const usage = await findPropUsage(slug, owner);
      if (usage.length) messages.push(`Prop "${slug}" kept — still used in ${describeUsage(usage)}.`);
      else await getMediaStore().deletePrefix(path.join(PROPS_DIR, slug));
    }
  }

  return messages;
}
