import { slugifyTheme } from 'shared';
import type { Dungeon, DungeonStructureType } from 'shared';

// Client and API are different origins (see every other file's identical constant, e.g.
// GamePage.tsx) — a bare "/api/..." path resolves against the client's own origin and 404s,
// silently (fetch caught below; an <img>/Image src just never loads, see getImage/drawScene's
// `if (img.complete)` guard). Every server-relative URL here must go through this prefix.
const API = `http://${window.location.hostname}:3001`;

// Solid color painted under every walkable cell before textures load (or if a dungeon's theme
// has no matching generated tileset) — a neutral gray-blue instead of a flash of blank floor.
export const FLOOR_FALLBACK_COLOR = '#4b5768';

const TEXTURE_MAP: Record<string, Record<string, string[]>> = {};

// All tilesets are generated server-side (see api/dungeon/tilesets.ts) — nothing is bundled with
// the client build. Fetched once at runtime; texturesFor() below returns [] for anything not in
// the manifest, and callers fall back to FLOOR_FALLBACK_COLOR. Manifest keys are already
// slugifyTheme'd server-side (that's the folder name), so this re-slug is just defensive.
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
    // texturesFor() already returns [] for anything missing.
  }
}

// Room's floor material variants for this dungeon's style pack, from whatever generated
// tilesets the API has served up. Returns [] if the pack or material isn't available — caller
// paints FLOOR_FALLBACK_COLOR instead. Slugifies the lookup key (not just lowercase) so
// "ancient_egypt_three"/"ancient egypt three"/"Ancient Egypt Three" all resolve to the same
// "ancient-egypt-three" the server generated the folder/manifest key as.
export function texturesFor(
  pack: string | undefined,
  material: string | undefined,
  _structureType: DungeonStructureType | undefined,
): string[] {
  const packKey = pack ? slugifyTheme(pack) : undefined;
  const materials = packKey ? TEXTURE_MAP[packKey] : undefined;
  if (!materials) return [];

  const materialKey = material?.toLowerCase();
  return (materialKey && materials[materialKey]) || [];
}

// True once every floor texture this dungeon's rooms reference has finished decoding (or the
// dungeon has none to load, e.g. no matching tileset — that room just paints
// FLOOR_FALLBACK_COLOR). Also kicks off loading for anything not yet requested, same as
// groundCache's own texturesFor/getImage calls — see canvas/useDungeonReady.ts, the only caller.
export function dungeonTexturesReady(dungeon: Dungeon): boolean {
  let ready = true;
  for (const room of dungeon.rooms) {
    const variants = texturesFor(dungeon.tilesetSlug ?? dungeon.theme, room.material, dungeon.structureType);
    for (const url of variants) {
      if (!getImage(url).complete) ready = false;
    }
  }
  return ready;
}

const imageCache = new Map<string, HTMLImageElement>();

// Bumped once whenever a previously-incomplete texture finishes decoding — the ground cache
// (see canvas/groundCache.ts) is baked from `img.complete` at bake time, so it needs a signal to
// know a rebake would now pick up a texture that wasn't ready before.
let textureLoadVersion = 0;
export function getTextureLoadVersion(): number {
  return textureLoadVersion;
}

// Loads each texture file exactly once and reuses the decoded element across every cell/room
// that references it — never re-fetch per cell.
export function getImage(url: string): HTMLImageElement {
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => { textureLoadVersion++; };
    img.src = url;
    imageCache.set(url, img);
  }
  return img;
}
