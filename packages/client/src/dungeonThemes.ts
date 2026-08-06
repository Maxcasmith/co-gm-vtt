import type { DungeonTheme } from 'shared';

interface ThemePalette {
  floor: string;
}

// Pure code-drawn per-room floor tint — no art assets, no generation step. `theme` comes from the
// dungeon manifest (LLM-assigned, closed vocabulary); unrecognized/missing theme falls back to 'stone'.
const THEME_PALETTES: Record<DungeonTheme, ThemePalette> = {
  stone:      { floor: '#2d2b42' },
  church:     { floor: '#3d3327' },
  graveyard:  { floor: '#243422' },
  prison:     { floor: '#2a2a2e' },
  kitchen:    { floor: '#3a2c20' },
  library:    { floor: '#2e2a3a' },
  armory:     { floor: '#332b2b' },
  throne:     { floor: '#3a2f18' },
  cave:       { floor: '#26241f' },
  laboratory: { floor: '#1f3230' },
};

export function paletteFor(theme: DungeonTheme | undefined): ThemePalette {
  return THEME_PALETTES[theme ?? 'stone'];
}
