const TODAY = new Date().toISOString().slice(0, 10);

export function buildExtractionPrompt(chunk: string): string {
  return `You are extracting entities from a tabletop RPG adventure module for a campaign management system.

Read the section below and extract all meaningful named entities. Output a raw JSON array — no markdown fences, no explanation, just the array.

Each element:
{ "type": "npc|creature|faction|location", "slug": "kebab-case-slug", "content": "<full markdown entity file>" }

---

## Entity types

### NPC
Named characters with individual personality, goals, secrets, or story roles.
Examples: Donavich, Ireena Kolyana, Strahd von Zarovich, Doru.

Format:
---
type: npc
name: Full Name
location: Where they operate
beliefs:
  - core belief or motivation
secrets:
  - secret they hold
connections: []
relationships: []
last_updated: ${TODAY}
---

2–3 sentence prose bio covering personality and role.

## DM Notes
Hidden information, true identity if concealed, narrative hooks, planned reveals.

---

### Creature
Generic monster types without individual story roles. Has a stat block, not a biography.
Examples: Strahd Zombie, Dire Wolf, Skeleton.
Do NOT create a creature entry for a named NPC even if they have combat stats.

Format:
---
type: creature
name: Creature Name
cr: 0
hp: 0
ac: 0
source: module
last_updated: ${TODAY}
---

## Traits
- **Trait Name**: Description copied from source text.

## Combat Role
1–2 sentences on how they fight and what makes them dangerous in a encounter.

IMPORTANT — finding stats: D&D 5e stat blocks always use these exact labels. Search the section text carefully:
- ac  → look for "Armor Class N" or "**Armor Class** N" — use the first integer N
- hp  → look for "Hit Points N" or "**Hit Points** N (Nd8+N)" — use the first integer N only
- cr  → look for "Challenge N" or "**Challenge** N (N XP)" — use the number N (may be a fraction like 0.5 → use 0.5)
If a label is present, you MUST use its value. Only use 0 when the label is genuinely absent.

---

### Faction
Organizations, cults, orders, guilds, noble houses with collective goals.

Format:
---
type: faction
name: Faction Name
goal: primary objective
known_to_players: false
members: []
connections: []
relationships: []
last_updated: ${TODAY}
---

Prose description — goals, methods, reach.

## DM Notes
Hidden members, player knowledge state, planned reveals.

---

### Location
Named places, rooms, or areas. IMPORTANT: copy any read-aloud boxed text (lines beginning with ">>" in the source) verbatim into the prose section — these are the DM's scripted descriptions.

Format:
---
type: location
name: Location Name
region: broader area or chapter name
connections: []
last_updated: ${TODAY}
---

[Verbatim boxed text here if present, then any additional prose description.]

## Inhabitants
List every NPC or creature who lives, works, or is stationed here using link syntax. One per line.
[[NPC:kebab-slug]]
[[NPC:another-slug]]

## Connected
List every adjacent location the party can reach from here. One per line.
[[Location:kebab-slug]]

## DM Notes
Hidden areas, traps, secrets, things players haven't discovered yet.

---

## Rules
- Only extract entities with meaningful detail (stat block, at least 3 sentences, or significant narrative content).
- Entities mentioned only in passing with no detail: skip them.
- For locations: copy >> boxed text verbatim, preserving every word.
- For creatures: extract any stated HP, AC, CR, and special abilities from the text.
- For NPCs: capture motivations, secrets, and key information they hold.
- Unknown numeric fields: use 0, not null or a placeholder string.
- Location slugs: generic room/area names (Kitchen, Bedroom, Cellar, Chapel, Crypt, Study, Library, Corridor, Room, Hall, etc.) MUST be prefixed with the parent dungeon or building context derived from the section heading. Example: if the section heading is "Areas of Death House" and the room is "Kitchen", the slug is "death-house-kitchen". If the heading is "Castle Ravenloft" and the area is "K15. Chapel", the slug is "castle-ravenloft-k15-chapel". Named unique locations (e.g. "Village of Barovia", "Yester Hill") are already specific — no prefix needed.
- Output valid JSON only — nothing before or after the array.

---

Adventure section:
${chunk}`;
}
