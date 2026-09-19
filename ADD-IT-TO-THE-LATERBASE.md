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
