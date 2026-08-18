import { slugifyTheme } from 'shared';
import type { DungeonStylePack, DungeonMaterial, DungeonStructureType } from 'shared';

// Client and API are different origins (see every other file's identical constant, e.g.
// GamePage.tsx) — a bare "/api/..." path resolves against the client's own origin and 404s,
// silently (fetch caught below; an <img>/Image src just never loads, see getImage/drawScene's
// `if (img.complete)` guard). Every server-relative URL here must go through this prefix.
const API = `http://${window.location.hostname}:3001`;

// Solid color painted under every walkable cell before textures load (or if a dungeon
// somehow resolves to zero variants) — avoids a flash of transparent/blank floor.
export const FLOOR_FALLBACK_COLOR = '#2d2b42';

const DEFAULT_PACK: DungeonStylePack = 'high_fantasy';
const DEFAULT_PACK_KEY = slugifyTheme(DEFAULT_PACK);

// Eagerly resolved at build time — dropping a new file into a Materials/<Pack>/<Material>/
// directory picks it up automatically, no code change needed. Keyed by slugifyTheme (not just
// lowercase) so a folder like "high_fantasy" matches the same key a generated theme's dungeon.theme
// value ("high_fantasy" or "high fantasy" or "High Fantasy") would resolve to — see texturesFor.
const modules = import.meta.glob<string>('./assets/Materials/*/*/*.{jpg,jpeg,png}', {
  eager: true,
  import: 'default',
});

const TEXTURE_MAP: Record<string, Record<string, string[]>> = {};
for (const [path, url] of Object.entries(modules)) {
  const [, , , pack, material] = path.split('/'); // './assets/Materials/<Pack>/<Material>/file.jpg'
  if (!pack || !material) continue;
  const packKey = slugifyTheme(pack);
  const materialKey = material.toLowerCase();
  (TEXTURE_MAP[packKey] ??= {})[materialKey] ??= [];
  TEXTURE_MAP[packKey]![materialKey]!.push(url);
}

// Generated tilesets (see api/dungeon/tilesets.ts) live server-side, not in this bundle — they
// can't go through the eager import.meta.glob above (that's resolved at build time, a theme
// generated after the app was built would never appear). Fetched once at runtime and merged into
// the same TEXTURE_MAP, so texturesFor() below needs no separate lookup path. Manifest keys are
// already slugifyTheme'd server-side (that's the folder name), so this re-slug is just defensive.
export async function loadRuntimeTilesets(): Promise<void> {
  try {
    const res = await fetch(`${API}/api/tilesets/manifest`);
    if (!res.ok) return;
    const manifest = await res.json() as Record<string, Record<string, string[]>>;
    for (const [rawPackKey, materials] of Object.entries(manifest)) {
      const packKey = slugifyTheme(rawPackKey);
      for (const [materialKey, urls] of Object.entries(materials)) {
        TEXTURE_MAP[packKey] ??= {};
        TEXTURE_MAP[packKey]![materialKey] = urls.map(u => `${API}${u}`);
      }
    }
  } catch {
    // best-effort — a failed fetch just means generated themes stay unavailable this session,
    // texturesFor() already falls back to the default pack for anything missing.
  }
}

// Room's floor material variants for this dungeon's style pack — falls back to the default
// pack if the assigned one has no directory on disk, and to grass/wood (by indoor/outdoor)
// if the room has no material or the pack doesn't have that material. Slugifies the lookup key
// (not just lowercase) so "ancient_egypt_three"/"ancient egypt three"/"Ancient Egypt Three" all
// resolve to the same "ancient-egypt-three" the server generated the folder/manifest key as.
export function texturesFor(
  pack: DungeonStylePack | string | undefined,
  material: DungeonMaterial | string | undefined,
  structureType: DungeonStructureType | undefined,
): string[] {
  const packKey = pack ? slugifyTheme(pack) : undefined;
  const resolvedPack = (packKey && TEXTURE_MAP[packKey] ? packKey : DEFAULT_PACK_KEY);
  const materials = TEXTURE_MAP[resolvedPack] ?? {};

  const materialKey = material?.toLowerCase();
  const fallbackMaterial: DungeonMaterial = structureType === 'building' ? 'wood' : 'grass';
  const resolvedMaterial = materialKey && materials[materialKey] ? materialKey : fallbackMaterial;

  return materials[resolvedMaterial] ?? [];
}

const imageCache = new Map<string, HTMLImageElement>();

// Loads each texture file exactly once and reuses the decoded element across every cell/room
// that references it — never re-fetch per cell.
export function getImage(url: string): HTMLImageElement {
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    imageCache.set(url, img);
  }
  return img;
}
