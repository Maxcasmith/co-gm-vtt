Before diagnosing a gameplay/session issue as a bug, check `CLAUDE-README.md` in this repo
root first — it tracks confirmed-intentional behavior and already-reviewed subsystems so they
don't get re-flagged.

# Research Before Asking

Whenever a question comes up (SCOPING open questions included), research codebase first —
grep, read files — before asking Max. If answer found, mark resolved with file:line source.
If research surfaces new questions, loop: research those too. Keep looping until either no
questions left, or hit ones genuinely unanswerable from the codebase (design decision, external
system, missing spec). Only surface that remaining set to Max. Never skip research to ask
straight away.

# Laterbase

`ADD-IT-TO-THE-LATERBASE.md` in this repo root tracks known, deliberately-deferred pitfalls —
places where we accepted a real tradeoff now (cost, latency, scale ceiling, data-loss risk, etc.)
instead of building the full fix, on the understanding we'd revisit once real data shows it's
actually needed. Check it alongside `CLAUDE-README.md` when diagnosing a "could this get worse
over time" style concern — it may already be a known, tracked one.

Keep it current automatically, without being asked each time:
- When a decision is made to defer a real, identified risk instead of fixing it now, add an entry
  (what was accepted, why, what would trigger revisiting it) — don't just fix-and-move-on.
- When work in this repo touches something already tracked there (the entity size in the NPC/
  faction entry, the chat-log shape in the NoSQL entry, etc.), update that entry's progress log
  with the date and what changed — growing, shrinking, mitigated, or made worse.
- When a tracked pitfall's trigger condition is actually hit (e.g. an entity file grows into the
  tens of KB, a NoSQL migration starts), flag it to Max explicitly — don't silently start building
  the deferred fix without confirming it's time.

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
