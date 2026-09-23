# Party Groups ("split the party")

Status as of 2026-09-20: **steps 1–15 built**. Confirmed design decisions live in
`CLAUDE-README.md` ("Party Groups — confirmed design"); deferred risks in
`ADD-IT-TO-THE-LATERBASE.md`. This file is the map of how it works.

---

## What it is

Players can split into colour-coded **tracks** (blue, red, green, yellow, pink, purple, orange,
teal) from the button beside their own portrait in the party HUD. While more than one track is
occupied the party is **split**:

- Each track only sees its own chat, DM replies and rolls. The DM for a track reads what that track
  saw, plus a deterministic "Elsewhere" line per other group **and every other group's recent
  transcript, keyed by track** (`describeOtherGroups`) — the world connector, so a character who
  walked off to meet another group is actually there and a brawl one group had really happened.
  DM-only: players still never see another track's lines.
- Each track has its own open-world scene (location / NPCs / factions).
- When everyone is back on one track the split **closes**: every branch becomes visible to everyone
  as an inline split block in the Adventure Log, and the DM gets a hidden LLM summary per branch.
- **Only while a session is running, and only for a party of 2+.** Every group change (move, add
  track, delete track) is refused outside a session or for a solo party, on the server and in the
  UI — splitting is something a group of players does in play. For a solo party the button, modal
  and Space+G shortcut are hidden entirely. A session that ends mid-split leaves the split as it
  stands.

Separately (split or not) combat is per individual and per fight — see "Combat" below.

---

## How it's built (architecture map)

### Tracks, splits, scenes
| Concern | Where |
|---|---|
| Types (`GroupColor`, `PartyGroups`, `PartySplit`, `TrackScene`, `trackOf`, `activeSplit`) | `packages/shared/src/types/partyGroups.ts` |
| Pure rules (move / add / remove track, split open/close) | `packages/api/src/partyGroups.ts` (`moveMember`, `addTrack`, `removeTrack`) |
| Persistence | `groups.json` per campaign (`storage.ts` `readPartyGroups`/`writePartyGroups`), mirrored in memory (`state.ts` `partyGroups`) |
| Socket handlers (`groups:move`, `groups:track:add`, `groups:track:remove`) — all gated on `sessionState` | `packages/api/src/socketHandlers/groups.ts` |
| Per-track scene (read/write/fold on reunion) | `partyGroups.ts` `sceneFor` / `updateScene` / `foldScenesOnReunion` |
| UI | `client/src/PartyGroupsModal.tsx`, `PartyHud.tsx` (button, disabled outside a session), `styles/party-groups.css`; shortcut Space+G (`GamePage.tsx`, listed in `ShortcutsOverlay.tsx`) |

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

Emit rule: `combat:*`, `encounter:*` and `creature:update` go to the fight; map events
(`token:moved`, `dungeon:loaded`, `dungeon:cleared`, `dungeon:generating`) go to the dungeon's
occupants (see below); only party-HUD events
(`combat:player:damage|heal|tempHp|dead|slots|featureResources`) stay campaign-wide.

### Tests
- `packages/api/src/partyGroups.selfcheck.ts` — track rules.
- `packages/api/src/dungeon/chainClosure.selfcheck.ts` — chain rule.
- `packages/api/src/domain/encounter.fights.selfcheck.ts` — fight registry, sides, merge.
- `packages/api/src/partyGroups.integration.selfcheck.ts` — end-to-end over real sockets with the
  stub LLM (see "Testing without an LLM"): chat/DM isolation, reunion, the chain rule, two fights
  at once, merging, victory XP, and split locations (one group in a dungeon, one out in the world).

### Testing without an LLM
`LLM_STUB=1` makes every AI feature use a deterministic stub adapter (`providers/stub.ts`) — no
API calls. The stub DM echoes which track it's answering and who it saw; side assignment splits
creatures by name prefix; `attack!` in a message makes the stub DM start an open-world fight.
Run the app with it (`LLM_STUB=1 pnpm api`) for manual multi-tab testing, or run the integration
selfcheck.

---

## Where everyone is (step 15)

A campaign can have **several dungeons loaded at once** — split groups in different places, plus
each open-world fight's own combat arena.

| Concern | Where |
|---|---|
| Dungeon registry (`Map<cid, Map<dungeonId, Dungeon>>`) + `dungeonsIn` / `dungeonById` / `registerDungeon` / `unregisterDungeon` | `state.ts` |
| Where a player is (`locationOf`), which map anything is on (`dungeonOf`), its positions (`positionsOf`), a fight's map (`fightDungeon`) | `state.ts` |
| Track locations (a dungeon id per track; absent = the open world) | `groups.json` `locations`, shared `locationOfTrack`, api `setTrackLocations` / `locationsOfTracks` |
| Storage | `dungeons/<id>.json` (`saveDungeon` / `loadDungeons` / `clearDungeon`); a legacy single `dungeon.json` still loads and puts the whole party in it |
| Map audiences | `toDungeon(cid, id)` / `toDungeonOf(cid, token)`, plus `broadcastDungeon` (adds `occupants` to the payload) |
| Arena per fight | `Encounter.arenaId`; `openArena` puts the empty battle map on screen the instant the fight starts, `placeArenaEnemies` drops the enemies in once the model returns; discarded on victory in `damage.ts` |

Rules that follow from it:

- **Positions live on the dungeon** (`Dungeon.positions`) — there is no campaign-wide position
  table, and a `token:move` for someone not standing in that dungeon is refused.
- **A track belongs to a place.** Entering a dungeon (`dungeon_gen`) moves only the acting tracks
  in; exiting moves only them out. A new track is created wherever its creator stands.
- **You can only switch between tracks in the same place** — the modal shows the others as
  "Elsewhere". (Max, 2026-09-20: a group that enters a dungeon belongs to that dungeon.)
- **A dungeon is kept while any group is inside it**, and discarded once the last one leaves.
- **Open-world combat** (`combat_init`) is refused only when the *acting group* is in a dungeon,
  so a group in town can fight while another is underground. Fights never chain or merge across
  different maps, and never on an arena.
- **The client** keeps one map at a time: it replaces its token positions when the map id changes,
  and its entrance placement only places that dungeon's `occupants`.
