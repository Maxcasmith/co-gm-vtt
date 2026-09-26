# The Laterbase

Known, deliberately-deferred pitfalls — decisions made to accept a real tradeoff for now, on the
understanding we'll come back to it once actual data (not speculation) shows it's needed. Each
entry: what we accepted, why, what would tell us it's time to act, and progress since.

Update this file whenever a "we know this could bite us later, but not yet" call gets made —
don't just fix and forget, and don't build the deferred solution speculatively either. See
CLAUDE.md's "Laterbase" section for the standing instruction to keep this current.

---

### In-scene NPC/faction entity content is no longer truncated in the live narration prompt

**What we accepted:** `session-processor/index.ts`'s `buildEntitySummaries` used to hard-slice any
in-scene NPC to 800 characters and faction to 600 (`content.slice(0, 800)` / `.slice(0, 600)`) before
feeding it into the DM's per-turn narration prompt. This was silently dropping whatever fell past
the cutoff — including an NPC's `## DM Notes` section, which is where their actual secret/true
identity lives (confirmed: `widow-salome-fenn.md` in `vesper-hollow`, 5478 bytes after one session,
had her secret mirror-reading ability and true depth entirely past the 800-char mark). We removed
the slice on 2026-09-15 — the prompt now gets each in-scene entity's full file, unabridged.

**Why we accepted the tradeoff instead of building compaction now:** the alternative (a compaction/
summarization pass that keeps a bounded "working profile" separate from the full durable record,
mirroring how `chat.json`/`archiveChatLog` already splits live-vs-archived) is real, buildable work —
but at today's actual entity sizes (largest on disk: 5.3KB) there's nothing to compact yet. Building
it speculatively, before any real campaign has an entity large enough to need it, is exactly the
kind of unrequested-abstraction-for-hypothetical-growth this project avoids elsewhere. Fixing the
silent-truncation bug now was necessary regardless of this tradeoff; deferring compaction was the
part that got weighed.

**What this reintroduces:** the live narration prompt (`getDMResponse` → `buildDMSystemPrompt` →
`buildNarrationPrompt`) fires on *every single chat message*, not just session-end. Every in-scene
NPC's full file now rides along on every turn. If a recurring NPC's file grows large over many
sessions (the exact "info added over time" growth this whole thread was about), this becomes:
- **Per-request token cost** — bigger prompt, every turn, for the lifetime of the campaign.
- **Latency** — more tokens to process before the DM can respond.
- **Attention dilution** — the one paragraph that actually matters (DM Notes/secret) sits inside an
  increasingly long, increasingly repetitive document; LLMs don't attend uniformly to all input, so
  a buried critical fact can become *less* reliably used even though it's technically in context.

**What would tell us it's time to act:** a real campaign (not a fixture) with an in-scene NPC's
entity file growing into the tens of KB — watch for it via the same `du -b entities/**/*.md | sort
-rn` check used to establish the 2026-09-15 baseline (5.3KB largest). Also watch DM response
latency/cost creeping up on campaigns with several long-lived recurring NPCs in scene at once.

**Progress log:**
- 2026-09-15 — slice removed, tradeoff accepted, this entry created. No compaction mechanism exists
  yet. Baseline: largest entity file across all fixture campaigns was 5.3KB
  (`vesper-hollow/entities/npc/widow-salome-fenn.md`).

---

### `chat.json` is a single ever-growing document per active session

**What we accepted:** `appendChatLog` (`storage.ts`) reads the entire chat array, pushes one
message, writes the whole array back — on every single chat message. `archiveChatLog` resets it to
`[]` at session end, archiving the full thing under `sessions/<date>-<n>.json`, so growth is bounded
*within* one session, not across the campaign's lifetime.

**Why it's deferred:** this only becomes a real problem if/when the NoSQL backend is DynamoDB
specifically (400KB hard item-size cap, no override) — see [[co-gm-vtt-data-architecture]] memory.
At today's real sizes the largest actual session archive on disk is 27KB (one full played session,
`vesper-hollow`), ~6.8% of that cap. MongoDB's 16MB document cap gives enough headroom that this
isn't urgent there either. Reshaping this into one-item-per-message (partition `campaignId`, sort
key `timestamp`) is real, known, scoped work — just not done until the NoSQL backend choice and
migration are actually underway.

**What would tell us it's time to act:** the NoSQL migration actually starting (this needs deciding
*before* lift-and-shift, not after), or any single live session's chat log approaching low hundreds
of KB before archiving.

**Progress log:**
- 2026-09-15 — entry created during the Mongo vs. DynamoDB architecture discussion. No NoSQL
  migration started yet.
- 2026-09-19 — Party Groups: messages sent while the party is split now carry `splitId` +
  `trackIds` (a few dozen bytes each), and the log is read more often — every DM turn and every
  player's history resync filters the whole array per track (`partyGroups.ts`
  `readChatContext`/`chatHistoryFor`). Growth per message is small; read frequency is the new cost.
  Per-message items keyed on `(campaignId, timestamp)` with `splitId`/`trackIds` attributes would
  make these per-track queries instead of full-array filters when the migration happens.
- 2026-09-22 — Roll breakdowns: every System line announcing a d20 roll (checks, saves, death
  saves, opportunity attacks, escapes, traps, lockpicks, improvised actions) now persists a
  `breakdown` object (dice, advantage sources, labeled modifiers) — roughly 150–300 bytes per roll
  line, several times a plain text line. Growth, not a trigger: a roll-heavy session might add tens
  of KB. The DM prompts only ever read `m.text`, so it costs storage/transfer, not tokens. If size
  ever bites, the breakdown is display-only and could move to its own per-message attribute or be
  dropped from the archived copy.

---

### A party split that spans a session end

**What we accepted:** Party Groups splits (see `partyGroups.ts`) are tracked in `groups.json` and
survive a session end, but `archiveChatLog` still resets `chat.json` to `[]` at session end. So a
split that's still open when the session ends loses its branch lines from the live log — the
reunion summary (`summarizeClosedSplit`) only sees what was said after the archive, and the split
block in the Adventure Log only shows the post-archive part. Separately, `processSession` runs over
the interleaved per-track lines, and session-end quest generation reads the manifest scene, which
is stale while each track has its own scene (`groups.json` `scenes`).

**Why it's deferred:** splitting and ending the session mid-split are both expected to be rare,
and handling it properly means either blocking session end while split or teaching the archive and
session processor about tracks. That's real work with no usage data yet.

**What would tell us it's time to act:** players ending sessions mid-split in practice, or a
reunion summary / session recap visibly missing what one group did.

**Progress log:**
- 2026-09-19 — entry created alongside Party Groups phases 1–3.
- 2026-09-19 — Max confirmed: ending the session ends it for everyone, split or not — that part is
  intended, not a bug. What stays deferred is only the side-effects above (archived branch lines
  missing from a still-open split's reunion summary, stale manifest scene for session-end quest
  generation). Not in Party Groups step 15's scope.

---

### One dungeon / combat arena per campaign while the party is split (Party Groups step 15)

**What we accepted:** `dungeons` and `tokenPositions` are still one-per-campaign. In the open world
with the party split, a dungeon one group enters is broadcast to every group, and an open-world
`COMBAT_INIT` is refused while *any* dungeon or combat arena is loaded — so a second group can't
start its own open-world fight until the first group's map is gone.

**Why it's deferred:** it's a ~150-reference migration (dungeon registry, positions on the dungeon,
per-occupant map events, arena per fight) on top of the step 14 fight re-key; worth doing once the
multi-fight work has been played with. Dungeon-crawl campaigns (one dungeon, everyone in it) aren't
affected at all.

**What would tell us it's time to act:** a split party in the open world where one group goes into
a dungeon or a fight and another group needs to fight or explore elsewhere at the same time.

**The plan:** fully written up in `docs/PARTY-GROUPS.md` → "Step 15" (design, file list, order,
open questions, done-looks-like).

**RESOLVED — 2026-09-20.** Step 15 was built: a dungeon registry keyed by dungeon id, positions
moved onto each `Dungeon`, per-track locations in `groups.json`, map events sent only to a
dungeon's occupants, and a combat arena per open-world fight. A group in town can now fight while
another is in a dungeon, and each dungeon is discarded once its last group leaves. See
`docs/PARTY-GROUPS.md` → "Where everyone is". Kept here for the history.

**Progress log:**
- 2026-09-19 — deferred at the end of the Party Groups build (steps 1–14 done).
- 2026-09-20 — built; entry closed.

---

### Alert swap pause with its timer off can hold a fight open indefinitely

**What we accepted:** the Alert initiative-swap pause (`lifecycle.ts` `beginAlertPause`) holds
round 1 until every connected Alert player confirms or cancels. With the "Swap Timer" house rule
off (`alertSwapTimerEnabled: false`), nothing ever auto-cancels — an Alert player who disconnects,
or walks away, mid-pause keeps the whole fight frozen before round 1 until they come back and
answer. A reconnecting player also doesn't get the sidebar re-sent (`syncFight` doesn't replay the
pause), so they'd have to be offered it again some other way.

**Why deferred:** turning the timer off is an explicit opt-in by the campaign owner, and the timer
is on by default. An auto-cancel on disconnect (or replaying the pause in `syncFight`) is a small
build but speculative until it's actually been hit in play.

**Trigger to revisit:** any report of a fight stuck at "X is in Initiative Swap", or campaigns
routinely running with the Swap Timer off.

**Progress log:**
- 2026-09-22 — deferred when the Alert swap pause and its timer toggle were built.

---

### Player-facing backstory tools read the full GM-only `world.md`

**What we accepted:** backstory check / generate / rewrite (`routes/campaigns.ts` `backstory-*`)
send the whole `world.md` — secrets, countdown, hooks included — to the LLM, and their output
goes straight to the player. The only thing stopping spoilers is the prompt instruction in
`prompts.ts` (`buildBackstoryCheckPrompt`, `BACKSTORY_CONTENT_RULES`) to use the lore for tone
only and never name or allude to its contents. An LLM that ignores that leaks GM secrets.

**Why deferred:** `world.md` has no player-safe section (even the Overview names the big
secrets), so the full fix — a generated player-safe tone/pitch summary per world, fed to these
prompts instead — is a worldgen change. Prompt rules are enough until a leak is seen.

**Trigger to revisit:** any backstory check/generate/rewrite output naming a world faction, NPC,
place, or secret; or a player-safe world summary being built for another feature.

**Progress log:**
- 2026-09-22 — deferred when the backstory prompts were reworked to tone-fit + no-spoiler.

---

### Tile genre is only two levels deep (setting → tone), no era/place level

**What we accepted:** the genre tile map (`genre-tile-map.json`, see `dungeon/genreTiles.ts`) is
keyed setting (`fantasy|modern|scifi`) → tone (`standard|grim|horror|whimsical`) → material
category → material. Every material in a setting/tone bucket is listed (key + description) in
the manifest and arena-terrain prompts. A western and a present-day city share `modern/standard`;
the picking LLM tells them apart by the materials' descriptions, not by a bucket.

**Why deferred:** a third level (era or place type, e.g. modern: frontier/industrial/contemporary)
only shortens the list sent to the LLM. At ~15 tokens per material, even 50 in one bucket is
~750 input tokens — cheap next to one tileset generation — and every extra level splits reuse.

**Trigger to revisit:** any single setting/tone bucket passing ~50 materials, or the
`genre classification poor fit` debug log repeatedly naming the same gap.

**Progress log:**
- 2026-09-22 — deferred when genre moved from a manual 3-option picker to LLM classification
  from tags. Largest bucket at the time: `modern/horror`, 16 materials.

---

### The loading screen waits for art that already exists, never for art still being generated

**What we accepted:** the map/encounter loading screen now holds until the scene is fully loaded
and drawn (`canvas/useSceneReady.ts` — tileset manifest fetched, floor textures decoded, every
token/portrait/prop sprite settled). "Settled" deliberately counts a **404 as done**: creature
portraits (`dungeon/creaturePortraits.ts`) and prop sprites are fire-and-forget image generations
kicked off server-side without being awaited, so their files do not exist yet when the map ships.
An enemy whose portrait is still being drawn therefore appears as its fallback token, and the real
portrait pops in later — behind an already-dismissed loading screen.

**Why we accepted the tradeoff:** the alternative is holding the whole party behind a full-screen
lockout for a multi-image generation job (one call per distinct creature, tens of seconds with a
real image provider), for art that is cosmetic — `drawToken`'s img-less branch has always covered
its absence. Floor tilesets *are* awaited before the map ships (`ensureTilesetSupport` in
`generateDungeon`, `applyArenaTerrain` for arenas) because the client draws them synchronously with
no fallback-then-fill path; portraits have one, so they stay fire-and-forget.

**What would tell us it's time to act:** players reporting enemies visibly "changing face"
mid-fight rather than merely arriving unportraited, or portrait generation routinely outlasting the
fight it was for. The fix, if wanted, is a `creature:portrait:ready` event that re-broadcasts the
entity once its file lands, so it fades in deliberately instead of on the next incidental redraw —
not extending the loading screen to cover it.

**Progress log:**
- 2026-09-23 — entry created while fixing the loading screen to wait for the rest of the scene
  (arena enemies were being placed *after* `encounter:ready`, `syncFight` was emitting an empty
  `encounter:ready` before generation even began, and readiness was being computed before the
  tileset manifest had been fetched). Portraits were the one asset class deliberately left out.
- 2026-09-23 — correction: prop sprites are **not** fire-and-forget. `generatePropSprites` is
  awaited inside `generateDungeon`'s `Promise.all` alongside tilesets, so prop art exists before
  the map ships. This entry now only covers creature portraits.

### Room layout (pass 3) fires one model call per room with no concurrency cap

`furnishRooms` (`dungeon/roomLayout.ts`) lays out every non-stairwell room in parallel via a bare
`Promise.all` — a 19-room dungeon sends ~17 simultaneous streamed calls to the dungeonGeneration
provider (currently kimi-k3), on top of the tileset and prop-sprite image calls running alongside.

**Why we accepted the tradeoff:** the whole point of the per-room split is wall-clock time. Measured
in the prototype, one room takes 52–83s; serial, 17 rooms would be ~20 minutes, parallel it is
roughly the slowest single room. Each room also falls back to the zone placer on any failure, so a
rate-limited room degrades to the old layout rather than an empty one.

**What would tell us it's time to act:** `dungeon/roomLayout:<room>` errors in `storage/logs`
naming a 429 / rate limit, or a run where several rooms fall back together. The fix is a small
concurrency limit (4–6 in flight) around the per-room map — not serialising it.

**Progress log:**
- 2026-09-23 — entry created when pass 3 was wired into `generateDungeon`.
- 2026-09-23 — first real measurement (refurnishing the 17-room gas-station adventure): rooms
  finished between ~30s and ~7.5min, 455.7s wall clock. The prototype's 52–83s per room did not
  hold with 17 in flight — consistent with provider-side throttling. No 429s logged, so not yet the
  trigger, but concurrency is already costing time.

### Organic dungeon layout kept dormant instead of deleted

`fetchManifest` (`dungeon/manifest.ts`) no longer tells the model organic layouts exist and always
sets `structureType: 'building'` — every dungeon, outdoor ones included, is now a graph of rooms
wired by `connectsTo`, with per-connection `doors` (`none | open | closed | locked`). The organic
path (`generator.ts`'s `generateGrid`, the organic branch in `dungeon/index.ts`, `ManifestRoom.key`)
is still live code: the fixed fallback manifest and combat arenas use it, and it lets the switch be
reverted by one line.

**Why we accepted the tradeoff:** the organic generator chained rooms in list order with thin
corridors, so connections meant nothing ("Subway Entrance → Overturned Ambulance → Pharmacy" in
During the Storm). Deleting it outright would also mean rebuilding the fallback manifest and arena
map on the building layout, which nothing currently needs.

**What would tell us it's time to act:** a decision that organic is gone for good (delete it, move
the fallback and arena onto the building layout), or a location type the building layout can't
express (a real cave system wanting irregular walls) — which would mean a new organic generator
that follows `connectsTo`, not reviving the old one.

**Progress log:**
- 2026-09-23 — entry created when the manifest prompt went building-only.

---

### Level-up grants no per-level class/species features (Ranger's Deft Explorer is simply absent)

**What we accepted:** `CLASS_FEATURES` (`character-creation/srd.ts`) is a level-1-only table, and
`LevelUpScreen.tsx` only re-lists it — nothing grants a feature, or asks for a choice, at level 2+.
On 2026-09-25 the Ranger's level-1 "Expertise (two skills)" was removed because it isn't a 2024
level-1 feature; the real one, Deft Explorer (Expertise in one skill + two languages), arrives at
Ranger level 2 and so currently never arrives at all. Same gap covers every later-level trait
already described in text (Celestial Revelation L3, Large Form / Chromatic Warding / Gem Flight L5,
lineage spells at L3/L5, Bard's Expertise at L2, ...).

**Why deferred:** building per-level feature grants + choice UI into level-up is its own feature;
removing the wrong level-1 grant was the correct fix on its own.

**Trigger to revisit:** players regularly levelling past 1 and noticing missing features, or the
next time any level-2+ feature needs to actually work mechanically. Ranger characters created before
2026-09-25 still carry their two persisted `expertiseSkills` — leave them or clean up at that point.
