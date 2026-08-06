import type { DungeonStylePack, DungeonMaterial, DungeonStructureType } from 'shared';

// Solid color painted under every walkable cell before textures load (or if a dungeon
// somehow resolves to zero variants) — avoids a flash of transparent/blank floor.
export const FLOOR_FALLBACK_COLOR = '#2d2b42';

const DEFAULT_PACK: DungeonStylePack = 'high_fantasy';

// Eagerly resolved at build time — dropping a new file into a Materials/<Pack>/<Material>/
// directory picks it up automatically, no code change needed.
const modules = import.meta.glob<string>('./assets/Materials/*/*/*.{jpg,jpeg,png}', {
  eager: true,
  import: 'default',
});

const TEXTURE_MAP: Record<string, Record<string, string[]>> = {};
for (const [path, url] of Object.entries(modules)) {
  const [, , , pack, material] = path.split('/'); // './assets/Materials/<Pack>/<Material>/file.jpg'
  if (!pack || !material) continue;
  const packKey = pack.toLowerCase();
  const materialKey = material.toLowerCase();
  (TEXTURE_MAP[packKey] ??= {})[materialKey] ??= [];
  TEXTURE_MAP[packKey]![materialKey]!.push(url);
}

// Room's floor material variants for this dungeon's style pack — falls back to the default
// pack if the assigned one has no directory on disk, and to grass/wood (by indoor/outdoor)
// if the room has no material or the pack doesn't have that material.
export function texturesFor(
  pack: DungeonStylePack | string | undefined,
  material: DungeonMaterial | string | undefined,
  structureType: DungeonStructureType | undefined,
): string[] {
  const packKey = pack?.toLowerCase();
  const resolvedPack = (packKey && TEXTURE_MAP[packKey] ? packKey : DEFAULT_PACK) as string;
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
