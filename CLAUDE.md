Before diagnosing a gameplay/session issue as a bug, check `CLAUDE-README.md` in this repo
root first — it tracks confirmed-intentional behavior and already-reviewed subsystems so they
don't get re-flagged.

# Rules Ruleset

This project implements D&D **2024 rules (5.5e / "One D&D")**, not the 2014 (5e) rules. When
implementing or fixing any rules logic (spellcasting, class features, slot progression, feats,
species traits, etc.), use the 2024 PHB as the source of truth even if it contradicts older
memorized 2014 mechanics. Known deltas that have bitten this codebase before:

- Paladin/Ranger get their Spellcasting feature at **level 1** in 2024 (2014 had it at level 2).
  Half-caster slot progression for Paladin/Ranger rounds level **up** (same as Artificer), not down.

If unsure whether a rule differs between 2014 and 2024, check `packages/client/src/character-creation/srd.ts`
(class feature tables) for the version already encoded there before assuming 2014 behavior, and
flag the assumption if it can't be confirmed from the codebase.
