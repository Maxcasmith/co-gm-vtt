import type { AttackContext, Spell, HookSpec } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { encounters } from '../../../state.ts';
import { getCharacter } from '../../../storage.ts';
import { offerReaction } from '../reactionPrompt.ts';
import { trySpendSpellSlot, emitResources } from '../../runtime.ts';
import { registerSpellHooks } from '../registerSpellHooks.ts';
import { findSpell } from '../../../routes/spells.ts';

/** Total AC a spell's hooks would add — what makes offering it worthwhile. */
function boostValueFor(hooks: HookSpec[] | undefined): number {
  return (hooks ?? []).filter(h => h.type === 'acModifier').reduce((sum, h) => sum + (h.value ?? 0), 0);
}

/**
 * Interrupts attack resolution to offer its owner every "defend" reaction spell (Shield, ...)
 * that's currently worth casting, and applies whichever one they pick.
 *
 * One broker per player, registered once at combat start — not one hook per spell — so a
 * player who knows more than one defend-shaped reaction sees them together in a single sidebar
 * offer instead of being asked about each spell in sequence.
 *
 * Runs at low priority so any AC modifier already in play has been applied first; otherwise this
 * would offer Shield to someone whose Shield is already up.
 */
export class ReactionOfferHook extends Hook<'afterAttackRoll'> {
  readonly stage = 'afterAttackRoll' as const;

  constructor(props: HookProps) {
    super({ priority: -50, ...props });
  }

  matches(ctx: AttackContext): boolean {
    return ctx.targetId === this.ownerId && ctx.targetIsPlayer;
  }

  async apply(ctx: AttackContext, engine: StateEngine): Promise<void> {
    const cid = engine.campaignId;
    const participant = encounters.get(cid)?.findParticipant(this.ownerId);
    if (!participant?.hasResource('reaction')) return;
    if (engine.hasHookOwnedBy(this.ownerId, 'reactionLock')) return;

    const char = await getCharacter(cid, this.ownerId);
    if (!char) return;

    // ctx.hit is only re-derived by the runtime after the whole chain, so it can be stale by the
    // time this runs (a higher-priority AC modifier may have moved the goalposts). Recompute from
    // the live numbers instead: offer only spells that currently land and whose boost saves it.
    const candidates: { spell: Spell; boost: number }[] = [];
    for (const name of char.spells ?? []) {
      const spell = findSpell(name);
      if (spell?.combat?.reactionTrigger?.on !== 'beingHit') continue;
      const boost = boostValueFor(spell.combat.hooks);
      if (boost <= 0) continue;
      const landsNow = ctx.total >= ctx.ac;
      const missesAfterBoost = ctx.total < ctx.ac + boost;
      if (landsNow && missesAfterBoost) candidates.push({ spell, boost });
    }
    if (!candidates.length) return;

    const picked = await offerReaction(
      this.ownerId,
      candidates.map(c => ({
        spellName: c.spell.name, kind: 'defend' as const,
        attackerName: ctx.attackerName, sourceName: ctx.sourceName,
        attackTotal: ctx.total, currentAc: ctx.ac, boostedAc: ctx.ac + c.boost,
      })),
    );
    if (!picked) return;
    const chosen = candidates.find(c => c.spell.name === picked);
    if (!chosen) return;

    // Re-check after the await — the player spent the whole window deciding, and anything could
    // have changed in it (another reaction resolved, the fight ended, the last slot went).
    if (!encounters.get(cid) || !participant.hasResource('reaction')) return;
    if (!(await trySpendSpellSlot(cid, this.ownerId, char, chosen.spell.level))) return;
    participant.trySpend('reaction');
    emitResources(participant);

    await registerSpellHooks(engine, chosen.spell.combat?.hooks ?? [], chosen.spell.name, {
      ownerId: this.ownerId,
      casterId: this.ownerId,
      casterLevel: char.level ?? 1,
      slotLevel: chosen.spell.level,
      currentRound: encounters.get(cid)?.currentRound?.number ?? 1,
    });

    // Shield protects against the attack that triggered it, but the hook just registered only
    // fires on *subsequent* attacks — so the bonus is applied to this context directly too.
    ctx.ac += chosen.boost;
    console.log(`[reaction] ${participant.name} casts ${chosen.spell.name} — AC ${ctx.ac - chosen.boost} → ${ctx.ac} vs ${ctx.total}`);
  }
}
