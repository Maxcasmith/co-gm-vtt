import type { AttackContext, Spell } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { encounters } from '../../../state.ts';
import { getCharacter } from '../../../storage.ts';
import { offerReaction } from '../reactionPrompt.ts';
import { trySpendSpellSlot, emitResources } from '../../runtime.ts';
import { registerSpellHooks } from '../registerSpellHooks.ts';

/**
 * Interrupts attack resolution to offer its owner a reaction-cast defensive spell (Shield), and
 * applies it if they accept.
 *
 * Registered for every reaction spell a player knows when combat begins — the offer has to exist
 * before the attack that triggers it, since there is no other moment to ask.
 *
 * Runs at low priority so any AC modifier already in play has been applied first; otherwise this
 * would offer Shield to someone whose Shield is already up.
 */
export class ReactionOfferHook extends Hook<'afterAttackRoll'> {
  readonly stage = 'afterAttackRoll' as const;
  private readonly spell: Spell;

  constructor(props: HookProps & { spell: Spell }) {
    super({ priority: -50, ...props });
    this.spell = props.spell;
  }

  /** Total AC this spell's hooks would add — what makes the offer worth making. */
  private boostValue(): number {
    return (this.spell.combat?.hooks ?? [])
      .filter(h => h.type === 'acModifier')
      .reduce((sum, h) => sum + (h.value ?? 0), 0);
  }

  matches(ctx: AttackContext): boolean {
    if (ctx.targetId !== this.ownerId || !ctx.targetIsPlayer) return false;
    const boost = this.boostValue();
    if (boost <= 0) return false;
    // ctx.hit is only re-derived by the runtime after the whole chain, so it can be stale by the
    // time this runs (a higher-priority AC modifier may have moved the goalposts). Recompute from
    // the live numbers instead: offer only when the attack currently lands and the boost saves it.
    const landsNow = ctx.total >= ctx.ac;
    const missesAfterBoost = ctx.total < ctx.ac + boost;
    return landsNow && missesAfterBoost;
  }

  async apply(ctx: AttackContext, engine: StateEngine): Promise<void> {
    const cid = engine.campaignId;
    const participant = encounters.get(cid)?.findParticipant(this.ownerId);
    if (!participant?.hasResource('reaction')) return;

    const char = await getCharacter(cid, this.ownerId);
    if (!char) return;

    const boost = this.boostValue();
    const accepted = await offerReaction(this.ownerId, {
      spellName: this.spell.name,
      attackerName: ctx.attackerName,
      sourceName: ctx.sourceName,
      attackTotal: ctx.total,
      currentAc: ctx.ac,
      boostedAc: ctx.ac + boost,
    });
    if (!accepted) return;

    // Re-check after the await — the player spent the whole window deciding, and anything could
    // have changed in it (another reaction resolved, the fight ended, the last slot went).
    if (!encounters.get(cid) || !participant.hasResource('reaction')) return;
    if (!(await trySpendSpellSlot(cid, this.ownerId, char, this.spell.level))) return;
    participant.trySpend('reaction');
    emitResources(participant);

    registerSpellHooks(engine, this.spell, {
      ownerId: this.ownerId,
      casterId: this.ownerId,
      casterLevel: char.level ?? 1,
      slotLevel: this.spell.level,
      currentRound: encounters.get(cid)?.currentRound?.number ?? 1,
    });

    // Shield protects against the attack that triggered it, but the hook just registered only
    // fires on *subsequent* attacks — so the bonus is applied to this context directly too.
    ctx.ac += boost;
    console.log(`[reaction] ${participant.name} casts ${this.spell.name} — AC ${ctx.ac - boost} → ${ctx.ac} vs ${ctx.total}`);
  }
}
