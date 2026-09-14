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

### DM sometimes narrates a check's outcome instead of requesting the roll

Player asked to make an Insight check; first DM reply gave flavor-text tells for free with
no `[[REQUEST_CHECK:...]]` tag and no roll — only a second, repeated ask actually triggered
the roll. The tag mechanism and its rule (`prompts.ts` — "write only narrative setup, do NOT
name the check, stop and wait") exist and are usually followed elsewhere in the same session;
this looks like an intermittent prompt-compliance miss rather than a missing feature.
