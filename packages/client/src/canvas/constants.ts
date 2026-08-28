export const CELL = 64;
export const TOKEN_R = 24;
export const DUNGEON_ENTITY_R = 10;
export const DOOR_BUTTON_R = 15; // half-width of the door's square icon button, px at zoom 1
export const FLOAT_DUR = 950;   // ms for floating text
export const FLASH_DUR = 220;   // ms for token flash
export const BUFF_PULSE_PERIOD = 1400; // ms per ring cycle for an armed self-buff (Searing/Thunderous Smite)
export const IMPACT_DUR = 450; // ms for the one-shot burst when an armed buff's hit lands
export const SWING_DUR = 250;  // ms for a weapon attack's slash/streak effect
export const SIGHT_RADIUS = 20; // square (Chebyshev) fog-of-war radius, in cells — mirrors PLAYER_SIGHT_RADIUS server-side
// Doors render by flat distance from the player's own token, not the wall-blocked fog polygon
// every other map marker uses — a passive-awareness radius rather than strict line of sight, so a
// door doesn't stay invisible over some ray-casting technicality (a corner, a diagonal) once
// you're genuinely standing near it. 5 cells = 25ft.
export const DOOR_AWARENESS_RADIUS = 5;
export const FOG_OF_WAR_COLOR = '#020201';
export const DUNGEON_BG = FOG_OF_WAR_COLOR;
export const DARKVISION_THRESHOLD = 0.5; // illumination at/below this counts as "dark" — darkvision only activates here, not in merely dim light
export const LIGHT_PENUMBRA_FT = 20; // cosmetic-only glow past a light source's hard mechanical cutoff (fog-of-war/senses ignore this) — see useVision's glowCells
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.0;
