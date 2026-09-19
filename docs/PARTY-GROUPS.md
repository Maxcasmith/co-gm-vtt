# Party Groups ("split the party")

Status as of 2026-09-19: **steps 1–14 built, step 15 deferred** (plan below). Confirmed design
decisions live in `CLAUDE-README.md` ("Party Groups — confirmed design"); deferred risks in
`ADD-IT-TO-THE-LATERBASE.md`. This file is the map of how it works and what's left.

---

## What it is

Players can split into colour-coded **tracks** (blue, red, green, yellow, pink, purple, orange,
teal) from the button beside their own portrait in the party HUD. While more than one track is
occupied the party is **split**:

- Each track only sees its own chat, DM replies and rolls. The DM for a track only reads what that
  track saw, plus a deterministic "Elsewhere" line per other group.
- Each track has its own open-world scene (location / NPCs / factions).
- When everyone is back on one track the split **closes**: every branch becomes visible to everyone
  as an inline split block in the Adventure Log, and the DM gets a hidden LLM summary per branch.

Separately (split or not) combat is per individual and per fight — see "Combat" below.

---

## How it's built (architecture map)

### Tracks, splits, scenes
| Concern | Where |
|---|---|
| Types (`GroupColor`, `PartyGroups`, `PartySplit`, `TrackScene`, `trackOf`, `activeSplit`) | `packages/shared/src/types/partyGroups.ts` |
| Pure rules (move / add / remove track, split open/close) | `packages/api/src/partyGroups.ts` (`moveMember`, `addTrack`, `removeTrack`) |
| Persistence | `groups.json` per campaign (`storage.ts` `readPartyGroups`/`writePartyGroups`), mirrored in memory (`state.ts` `partyGroups`) |
| Socket handlers (`groups:move`, `groups:track:add`, `groups:track:remove`) | `packages/api/src/socketHandlers/groups.ts` |
| Per-track scene (read/write/fold on reunion) | `partyGroups.ts` `sceneFor` / `updateScene` / `foldScenesOnReunion` |
| UI | `client/src/PartyGroupsModal.tsx`, `PartyHud.tsx` (button), `styles/party-groups.css` |

### Chat routing
- **Every chat line goes through `postChat(cid, msg, audience)`** (`partyGroups.ts`). `audience` is
  who the message is *about* (character names/ids, creature ids) or `'all'`. Anyone named who is in
  a fight expands to that whole fight's players.
- While split, messages are tagged `splitId` + `trackIds` (`ChatPayload`) and delivered only to
  those tracks. Not split → whole campaign, untagged.
- DM turns: `session.ts` `dispatchDMResponse(cid, audience)` — reply, `dm:thinking`, DM context
  (`readChatContext`) and the DM queue key are all per track.
- History: `chatHistoryFor` (live split → own track only; closed splits → everyone). Re-sent on
  reunion and on a mid-split track switch. Client replaces the log wholesale (`vtt:chat:history`).
- Reunion: `summarizeClosedSplit` writes one bracketed, player-hidden System line per branch.
- Client: `SplitBlock.tsx` renders one split inline (dot rail per track, filter chips).

### Socket audiences (decision 14c)
Only the **campaign room** is a socket.io room. Narrower audiences are resolved to socket ids *at
emit time* from game state — `state.ts` `toSockets` / `toFight` / `toFightOf`,
`partyGroups.ts` `toTracks`. No join/leave bookkeeping, so merges, reconnects and track changes can
never leave membership stale. `io.to([])` broadcasts to everyone, so an empty audience targets a
room nobody joins (`NOBODY_ROOM`).

### Combat
| Concern | Where |
|---|---|
| Fight registry (many fights per campaign) | `state.ts` `fightsIn` / `fightOf` / `registerFight` / `unregisterFight` / `isRegisteredFight` |
| Per-fight state (ended, enemiesReady, startedAt, scores, marks, advancing, pendingPlayerNames) | `domain/encounter.ts` `Encounter` |
| Persistence | `encounters/<fightId>.json` (`storage.ts` `saveEncounter`/`loadEncounters`/`clearEncounter`); legacy `encounter.json` still loads |
| Chain rule (7 cells + line of sight, transitive) | `dungeon/index.ts` `chainClosure`, `state.ts` `COMBAT_CHAIN_RADIUS` |
| Joining / merging fights | `combat/runtime/lifecycle.ts` `resolveFightChains`, `addPlayersToFight`, `syncFight` |
| Starting fights | `dungeon/runtime.ts` `startDungeonCombat` (dungeon aggro), `effects.ts` `combat_init` (open world) |
| Sides (LLM decides who fights whom) | `session-processor/imagePrompts.ts` `assignCombatTeams`; applied in `dungeon/runtime.ts` `assignSides` via `Encounter.moveToTeam` |
| Hook scoping (one shared StateEngine) | `StateEngine.trigger(stage, ctx, scope)`; fight-wide stages pass `fightScope(encounter)`; `endCombat` unregisters only that fight's owners |

Emit rule: `combat:*`, `encounter:*`, `creature:update` go to the fight; party-HUD events
(`combat:player:damage|heal|tempHp|dead|slots|featureResources`) and map events (`token:moved`,
`dungeon:loaded`) stay campaign-wide.

### Tests
- `packages/api/src/partyGroups.selfcheck.ts` — track rules.
- `packages/api/src/dungeon/chainClosure.selfcheck.ts` — chain rule.
- `packages/api/src/domain/encounter.fights.selfcheck.ts` — fight registry, sides, merge.
- `packages/api/src/partyGroups.integration.selfcheck.ts` — end-to-end over real sockets with the
  stub LLM (see "Testing without an LLM").

### Testing without an LLM
`LLM_STUB=1` makes every AI feature use a deterministic stub adapter (`providers/stub.ts`) — no
API calls. The stub DM echoes which track it's answering and who it saw; side assignment splits
creatures by name prefix; `attack!` in a message makes the stub DM start an open-world fight.
Run the app with it (`LLM_STUB=1 pnpm api`) for manual multi-tab testing, or run the integration
selfcheck.

---

## Step 15 — deferred: multiple dungeons + per-group dungeon occupancy + per-fight arenas

**Tag: HARD** (cross-cutting, ~150 references across ~15 files; bring a sub-blueprint for
approval before touching code, same as step 14).

### The limitation today
`dungeons` is `Map<cid, Dungeon>` — **one map per campaign**. `tokenPositions` is
`Map<cid, Record<token, pos>>` — one position table per campaign. Consequences once the party
splits in the **open world**:

1. Group A enters a dungeon (`[[DUNGEON_GEN]]` → `effects.ts` `dungeon_gen`) — the dungeon is
   loaded and broadcast to **every** group, including B who is still in town.
2. `combat_init` is hard-blocked while *any* dungeon is loaded (`effects.ts`, `dungeons.has(cid)`),
   so if A is in a dungeon or an open-world combat arena, **B cannot start an open-world fight at
   all**.
3. An open-world fight's combat arena is stored as *the* campaign dungeon (`dungeon/runtime.ts`
   `generateAndBroadcastEnemies` → `dungeons.set(cid, arena)`, `microDungeons` flag), so two groups
   can't each have one, and it replaces any real dungeon view.
4. Victory arena teardown (`combat/runtime/damage.ts`, `microDungeons` branch) clears the one
   campaign dungeon for everybody.

Dungeon-crawl campaigns are unaffected (one dungeon, everyone in it) — step 15 is an open-world
concern. Max confirmed (2026-09-19): **multiple dungeons at once are fine, no blocking**.

### Target design
1. **Dungeon registry per campaign, keyed by dungeon id** — `Map<cid, Map<dungeonId, Dungeon>>`,
   same shape as the fight registry. Helpers: `dungeonById(cid, id)`, `dungeonOf(cid, charName)`
   (the dungeon that character's scene points at), `dungeonsIn(cid)`.
2. **Where a character is** = their track's scene: `TrackScene` gains `dungeonId?: string`. Not
   split → the manifest carries it (`SessionManifest.dungeonId`). Dungeon-crawl campaigns: the one
   dungeon's id, always.
3. **Token positions live on the dungeon they're in** — make `Dungeon.positions` (already persisted)
   the live source and delete the `tokenPositions` map; `withLivePositions` becomes a no-op and
   goes. Every `tokenPositions.get(cid)` becomes `dungeonOf(cid, key)?.positions` (keyed by who's
   moving) — the same "resolve from a participant" pattern as `fightOf`.
4. **Storage per dungeon** — `dungeons/<id>.json`; `loadDungeon` becomes `loadDungeons`, migrating a
   legacy single `dungeon.json` (assign it to the manifest's `dungeonId`).
5. **Map events to occupants only** — `dungeon:loaded`, `dungeon:cleared`, `token:moved`,
   `dungeon:generating` go to `toDungeon(cid, dungeonId)` (players whose scene is in it), resolved at
   emit time like `toFight`. The client keeps a single `dungeon` state; the server just never sends
   it a map it isn't standing in.
6. **Arena per fight** — an open-world fight gets `Encounter.arenaId` pointing at an arena dungeon in
   the registry (`Dungeon.arena` already exists); the fight's players' scene points at it for the
   fight's duration and back afterwards. Delete `microDungeons`. Victory discards only that arena.
7. **Effects follow the acting group** — `dungeon_gen` / `dungeon_exit` set/clear `dungeonId` on
   the acting audience's tracks (`applyEffects` already resolves `tracks`), not the campaign.
8. **Lift the guard** — `combat_init` is refused only if the *acting group* is inside a dungeon, not
   if any dungeon exists.
9. **Chain/merge stay within one dungeon** — `resolveFightChains` iterates fights per dungeon;
   fights in different dungeons never merge.
10. **Resync on track change** — moving tracks (or reunion) can change which dungeon a player is
    in: send `dungeon:loaded` for the new one, or `dungeon:cleared` if the new scene is outdoors.

### Files (reference counts at time of writing)
`dungeons.get(`: socketHandlers/combat.ts (13), dungeon/runtime.ts (9), combat/runtime/damage.ts (5),
session.ts (3), lifecycle.ts (2), environment.ts (2), connection.ts, chat.ts, partyGroups.ts,
questChain.ts, traps.ts, movement.ts.
`tokenPositions.get(`: socketHandlers/combat.ts (15), dungeon/runtime.ts (11), movement.ts (4),
lifecycle.ts (4), connection.ts, session.ts, ai.ts, executor.ts, chat.ts, partyGroups.ts, hooks.
`'dungeon:loaded'` emits: 22 across 8 files. `microDungeons`: 15 across 6 files.
Also `routes/campaigns.ts`, `routes/admin.ts`, `resourceUsage.ts` (`loadDungeon` readers), and the
client's `dungeon`/`tokenPositions` state in `GamePage.tsx` (should need no structural change).

### Suggested order (each its own blueprint step)
1. Registry + storage per dungeon + legacy migration (no behaviour change: one dungeon per campaign
   still) — typecheck-driven, like step 14b.
2. Positions onto `Dungeon.positions`, delete `tokenPositions`.
3. `dungeonId` on scene/manifest; `dungeonOf`; effects set it per acting group.
4. `toDungeon` audiences for map events; resync on track change.
5. Arena per fight; delete `microDungeons`; lift the `combat_init` guard.
6. Extend `partyGroups.integration.selfcheck.ts`: group A in a dungeon, group B in town starts an
   open-world fight; neither sees the other's map; A's victory doesn't clear B's arena.

### Open questions for Max (answer before building)
1. **Switching to a track that's somewhere else** — does the character travel there (appear next to
   a member of that track / at the dungeon entrance), or is switching blocked until the groups are
   physically in the same place?
2. **Leaving a dungeon while split** — `[[DUNGEON_EXIT]]` narrated for group A: does the dungeon stay
   loaded (and persisted) for a later return, or is it discarded once nobody's inside?
3. **Session end mid-split across different dungeons** — already a Laterbase risk ("A party split
   that spans a session end"); decide whether step 15 fixes it or it stays deferred.

### Done looks like
- Group A in a dungeon and group B in town: B never receives A's map or tokens; B can start an
  open-world fight with its own arena while A fights in the dungeon.
- A's victory tears down only A's fight; B's arena and A's dungeon are untouched.
- Reuniting / switching tracks puts the player on the right map.
- Dungeon-crawl campaigns behave exactly as before.
