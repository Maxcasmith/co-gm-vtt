import type { DungeonRoom, DungeonTheme } from 'shared';

interface ThemePalette {
  floor: string;
  propColor: string;
  propShape: 'rect' | 'circle' | 'lines';
}

// Pure code-drawn per-room texture — no art assets, no generation step. `theme` comes from the
// dungeon manifest (LLM-assigned, closed vocabulary); unrecognized/missing theme falls back to 'stone'.
const THEME_PALETTES: Record<DungeonTheme, ThemePalette> = {
  stone:      { floor: '#2d2b42', propColor: 'rgba(130,130,150,0.35)', propShape: 'rect' },
  church:     { floor: '#3d3327', propColor: 'rgba(190,160,100,0.4)',  propShape: 'rect' },
  graveyard:  { floor: '#243422', propColor: 'rgba(170,180,170,0.45)', propShape: 'rect' },
  prison:     { floor: '#2a2a2e', propColor: 'rgba(90,90,100,0.5)',    propShape: 'lines' },
  kitchen:    { floor: '#3a2c20', propColor: 'rgba(160,120,80,0.4)',   propShape: 'rect' },
  library:    { floor: '#2e2a3a', propColor: 'rgba(130,110,160,0.4)', propShape: 'rect' },
  armory:     { floor: '#332b2b', propColor: 'rgba(170,100,100,0.4)', propShape: 'lines' },
  throne:     { floor: '#3a2f18', propColor: 'rgba(210,180,90,0.4)',  propShape: 'circle' },
  cave:       { floor: '#26241f', propColor: 'rgba(120,110,90,0.4)',  propShape: 'circle' },
  laboratory: { floor: '#1f3230', propColor: 'rgba(90,190,170,0.4)',  propShape: 'circle' },
};

export function paletteFor(theme: DungeonTheme | undefined): ThemePalette {
  return THEME_PALETTES[theme ?? 'stone'];
}

// Deterministic per-room RNG so prop positions stay stable across re-renders instead of
// re-randomizing every frame — seeded from the room's own id.
function seededRng(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  return () => {
    h = (Math.imul(h ^ (h >>> 15), h | 1) ^ 0) | 0;
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61);
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
}

const PROPS_PER_ROOM = 3;

export function drawRoomProps(
  ctx: CanvasRenderingContext2D,
  room: DungeonRoom,
  cells: number[][],
  cellSz: number,
  panX: number,
  panY: number,
): void {
  const palette = paletteFor(room.theme);
  const floorCells: [number, number][] = [];
  for (let y = room.y; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (cells[y]?.[x] === 1) floorCells.push([x, y]);
    }
  }
  if (!floorCells.length) return;

  const rng = seededRng(room.id);
  const count = Math.min(PROPS_PER_ROOM, floorCells.length);
  const used = new Set<number>();
  ctx.fillStyle = palette.propColor;
  ctx.strokeStyle = palette.propColor;
  ctx.lineWidth = Math.max(1, cellSz * 0.08);

  for (let i = 0; i < count; i++) {
    let idx = Math.floor(rng() * floorCells.length);
    let attempts = 0;
    while (used.has(idx) && attempts < floorCells.length) { idx = (idx + 1) % floorCells.length; attempts++; }
    used.add(idx);
    const [cx, cy] = floorCells[idx]!;
    const px = cx * cellSz + panX + cellSz / 2;
    const py = cy * cellSz + panY + cellSz / 2;
    const size = cellSz * 0.4;

    if (palette.propShape === 'rect') {
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    } else if (palette.propShape === 'circle') {
      ctx.beginPath();
      ctx.arc(px, py, size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(px - size / 2, py - size / 3);
      ctx.lineTo(px + size / 2, py - size / 3);
      ctx.moveTo(px - size / 2, py + size / 3);
      ctx.lineTo(px + size / 2, py + size / 3);
      ctx.stroke();
    }
  }
}
