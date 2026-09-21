# Session/Gameplay Learnings

Confirmed product decisions and known-good subsystems, so future review passes don't
re-flag them as bugs. Add to this file (don't just fix and forget) whenever Max corrects
a finding — "that's intentional" or "already checked, works" — so the correction survives
past this conversation.

---

### Solo-party HP-to-0 = game over, by design

`encounter.ts:411` `allPlayersDown()` and `runtime.ts:1432`'s call into `endCombatDefeated()`
fire the instant every human player is at 0 HP — for a 1-PC party that's the very first
knockdown, before any death save is rolled. **This is correct, current behavior, not a bug.**
Death saves / `stabilizeParticipant` / `markPlayerDead` (`runtime.ts:210-298`, `750-762`) still
exist and still matter for multi-PC parties. Revisit only if Max asks for a solo-death-save
mode — until then, don't propose changing it.

With Party Groups (2026-09-19): a wipe ends the *session* only when the defeated fight held every
online player (`lifecycle.ts` `endCombatDefeated`'s `wholeParty`). One split group falling while
another is still up elsewhere just ends that group's fight — intentional, not a missed TPK.

### Combat system — reviewed, no open issues

Full pass done on turn order, damage application, death saves, nemesis binding. Confirmed
solid. Don't re-review from scratch; only look here if a specific new symptom shows up.

### Missing textures / token art on a campaign is usually config, not a missing feature

`storage.ts:43` — default config ships with `generateTilesets: false` and
`generateBestiaryPortraits: false`. A campaign with no `tilesetSlug` (`dungeon.json`) and no
`portraitSrc` on enemy stat blocks (`nemeses.json`) is very likely just running with these
flags off (or no image API key), not evidence the tileset/portrait pipeline
(`dungeon/tilesets.ts`, `dungeon/creaturePortraits.ts`) is unbuilt. Check `config.image.*`
before diagnosing further. Player character portraits/tokens (`party/<id>/portrait.jpg`,
`token.png`) are generated through a separate path and typically do exist even when the
above are off.

### Location entities can fork instead of getting renamed

Observed in `vesper-hollow`: party's back door opened onto an unnamed lane (auto-created as
`entities/location/the-lane-behind-the-sooted-swan.md`, generic scene-only stub). A session
later the lane's real name (Widdershins Lane) was learned in play, and a **second**,
fuller entity (`entities/location/widdershins-lane.md`) was created for the same physical
place instead of the stub being renamed/merged — and `manifest.json`'s `currentLocation`
was never repointed, so it still points at the abandoned stub. Net effect: the richer,
narratively-load-bearing entity is orphaned and anything keying off `currentLocation` sees
the sparse one instead. Worth a real fix (rename-in-place or merge-on-name-reveal in the
session processor) rather than a one-off note — flagged here so it's not re-discovered from
scratch next time.

### Quest engagement doesn't reliably fire QUEST_ADD

Player explicitly accepted a quest hook in dialogue ("I'll find Liora for you", took
payment) — per `session-processor/prompts.ts`'s own rule this should emit
`[[QUEST_ADD:...]]`/flip the matching quest from `undiscovered` to `open`. It didn't;
`quests.json` still showed the matching quest as `undiscovered` with an empty log after the
scene. Prompt-compliance gap in the LLM output, not a missing code path (`tag-processor.ts`
already parses `QUEST_ADD`/`QUEST_UPDATE`/`QUEST_RESOLVE` fine) — likely needs either a
stronger prompt nudge or a repair pass similar to the existing missed-pickup repair
(`session.ts` `repairMissedPickup`) for missed quest tags.

### Antagonist goals live in goals.json now, not inline on WorldActor

The old `world-state.json` shape embedded each antagonist/faction's goal and milestones directly
on `WorldActor` (`ultimateGoal`, `totalDays`, `daysElapsed`, `milestones`). This was unified with
the new player-goal framework (character sheet Goals tab) into one shared `Goal` type
(`packages/shared/src/types/goals.ts`), stored in `goals.json` per campaign. `WorldActor` is now
just `{id, name, type, goalId, currentStatus, status}` — a reference into `goals.json`, resolved
via `ownerType`/`ownerId`. A campaign with an old-shape `world-state.json` auto-migrates on first
`readWorldState` call (`storage.ts`'s `migrateLegacyWorldActors`) — this is expected, transparent,
one-time behavior, not a bug if you see a slim `WorldActor` missing `ultimateGoal` in a live
campaign's data. See `rest.advanceWorldActorGoals.selfcheck.ts` and
`storage.worldStateMigration.selfcheck.ts` for the covered behavior.

### The GM is virtual — there is no human GM

The "VDM"/GM role in this app is entirely AI-driven. There is no human game master
approving/adjudicating in the loop. Any feature that says "GM decides X" or "GM reviews Y"
(e.g. goal-failure adjudication, session-end quest generation) means an AI/LLM pass decides
it automatically — don't design a human-approval step into these flows unless Max asks for one.

### DM sometimes narrates a check's outcome instead of requesting the roll

Player asked to make an Insight check; first DM reply gave flavor-text tells for free with
no `[[REQUEST_CHECK:...]]` tag and no roll — only a second, repeated ask actually triggered
the roll. The tag mechanism and its rule (`prompts.ts` — "write only narrative setup, do NOT
name the check, stop and wait") exist and are usually followed elsewhere in the same session;
this looks like an intermittent prompt-compliance miss rather than a missing feature.

### Party Groups ("split the party") — confirmed design, 2026-09-19

Decided with Max; don't re-flag these as bugs:

- **Chat is hidden per track while split.** Players see only their own track's lines (and the DM
  only reads them) until everyone is back on one track; closed branches then show to everyone as
  an inline split block in the Adventure Log. No metagaming is the point. (`partyGroups.ts`
  `postChat` / `chatHistoryFor` / `readChatContext`.)
- **Combat joining is per individual, split or not.** A player joins a dungeon fight only once
  within `COMBAT_CHAIN_RADIUS` (7) cells *and* line of sight of anyone in it, chaining through
  whoever just joined (`dungeon/index.ts` `chainClosure`). Bystanders out of range stay exploring.
- **Several fights can run at once in one campaign** (dungeon only). Fights whose combatants come
  within chain range merge — the older one absorbs the newer (`resolveFightChains`). Open-world
  combat (DM `COMBAT_INIT`) is per acting group, no chaining.
- **Creatures can be on different sides.** An LLM groups creatures joining a fight by who'd fight
  whom (`assignCombatTeams`); every different side is hostile to every other, the party included.
  Victory = every non-player side down.
- **XP splits among the fight's own player characters**, not the whole campaign.
- **Rest stays party-wide** even while split (timeline consistency). **Re-merging tracks is
  manual.** **Changing track is blocked mid-fight, and outside a running session** (Max,
  2026-09-21) — splitting is something the party does in play. A session ending mid-split leaves
  the split standing; it just can't be changed until play resumes.
- **A track belongs to a place** (a dungeon, or the open world) — `groups.json` `locations`. Only
  the group the DM was narrating for enters/leaves a dungeon, you can only switch between tracks
  in your own location, and a dungeon stays loaded while any group is still inside it. Several
  dungeons (and an arena per open-world fight) can be loaded at once; positions live on each
  `Dungeon`, not in a campaign-wide table. See `docs/PARTY-GROUPS.md`.
