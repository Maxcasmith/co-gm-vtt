import type { TurnContext, Scaling, Condition, AbilityKey } from 'shared';
import { resolveSpellDamageDice } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { encounters } from '../../../state.ts';
import { rollDice, fmtMod } from '../../dice.ts';
import { applyDamageToCreature, applyDamageToPlayer, grantTempHpToPlayer, clearCondition, rollSavingThrow, rollSkillCheck } from '../../runtime.ts';

/**
 * Damages its owner at the start of each of their turns — Tasha's Caustic Brew's 2d4 acid while
 * covered, Searing Smite's Burning, and any other damage-over-time effect. `scaling` is optional
 * so this doubles as a plain "repeat a save at [stage] or keep a condition" hook with no damage
 * of its own — Cause Fear/Wrathful Smite's Frightened, which RAW re-saves at the END of the
 * owner's turn rather than the start, hence `stage` being a constructor choice instead of the
 * usual fixed literal (HookContextMap gives 'beforeTurn' and 'afterTurn' the identical
 * TurnContext, so nothing else about the class needs to change to support both).
 *
 * `tempHpScaling` (Heroism) grants temp HP each tick instead of/alongside a damage tick — same
 * scaling shape, just routed to grantTempHp instead of takeDamage.
 *
 * `conditionName`/`conditionNames` — most consumers apply exactly one (normalized into the same
 * internal list); Tasha's Hideous Laughter applies Prone AND Incapacitated together, cleared and
 * saved-against as one unit rather than two independently-rolled hooks.
 *
 * Routes through the beforeDamage/afterDamage stages rather than dealing damage directly, so
 * resistances and absorption compose with recurring damage the same way they do with a weapon hit.
 *
 * `saveToEnd` (Searing Smite) rolls a save right after the tick; success unregisters this hook —
 * and its expiry hook, so it doesn't fire again on a target already cleared — plus clears every
 * tracked condition. Without `saveToEnd` the hook only ever ends via its fixed-duration expiry
 * hook (Tasha's Caustic Brew's 10 rounds) or, with `endsIfCasterDamages` set, the moment its own
 * caster deals the owner any damage (Animal Friendship/Charm Person's "ends if you damage it") —
 * checked externally, at the one choke point all damage already funnels through
 * (applyDamageToPlayer/applyDamageToCreature in runtime.ts), not from inside this class.
 */
export class RecurringDamageHook extends Hook<'beforeTurn' | 'afterTurn'> {
  readonly stage: 'beforeTurn' | 'afterTurn';
  readonly casterId: string;
  private readonly casterLevel: number;
  private readonly slotLevel: number;
  private readonly scaling: Scaling | undefined;
  private readonly damageType: string | undefined;
  private readonly tempHpScaling: Scaling | undefined;
  /** scaling/tempHpScaling mode 'ability-mod' only (Heroism) — see Scaling's own doc. */
  private readonly casterAbilityMod: number | undefined;
  private readonly conditionNames: Condition[];
  private readonly saveToEnd: { ability: AbilityKey } | undefined;
  /** The spell's own save DC, computed once by the caster's stats at cast time — Searing Smite rerolls against this same number every turn, it doesn't change. Also the DC an escapeSkillCheck attempt is rolled against. */
  readonly dc: number | undefined;
  /** Ensnaring Strike/Entangle's "make a Strength (Athletics) check to escape" — player-initiated, unlike saveToEnd's automatic per-turn reroll. Checked by combat:condition:escape, not by apply(). */
  readonly escapeSkillCheck: string | undefined;
  /** Animal Friendship/Charm Person's "ends if you or an ally damages it" — allies aren't tracked here, just the caster (see the doc above). */
  readonly endsIfCasterDamages: boolean;

  constructor(props: HookProps & {
    casterId: string;
    casterLevel: number;
    slotLevel: number;
    scaling?: Scaling | undefined;
    damageType?: string | undefined;
    tempHpScaling?: Scaling | undefined;
    casterAbilityMod?: number | undefined;
    conditionName?: Condition | undefined;
    conditionNames?: Condition[] | undefined;
    saveToEnd?: { ability: AbilityKey } | undefined;
    dc?: number | undefined;
    stage?: 'beforeTurn' | 'afterTurn' | undefined;
    escapeSkillCheck?: string | undefined;
    endsIfCasterDamages?: boolean | undefined;
  }) {
    super(props);
    this.stage = props.stage ?? 'beforeTurn';
    this.casterId = props.casterId;
    this.casterLevel = props.casterLevel;
    this.slotLevel = props.slotLevel;
    this.scaling = props.scaling;
    this.damageType = props.damageType;
    this.tempHpScaling = props.tempHpScaling;
    this.casterAbilityMod = props.casterAbilityMod;
    this.conditionNames = props.conditionNames ?? (props.conditionName ? [props.conditionName] : []);
    this.saveToEnd = props.saveToEnd;
    this.dc = props.dc;
    this.escapeSkillCheck = props.escapeSkillCheck;
    this.endsIfCasterDamages = props.endsIfCasterDamages ?? false;
  }

  /** First tracked condition, for callers (combat:condition:escape) that only ever deal with one. */
  get conditionName(): Condition | undefined {
    return this.conditionNames[0];
  }

  private async clearConditions(cid: string): Promise<void> {
    for (const name of this.conditionNames) await clearCondition(cid, this.ownerId, name);
  }

  /**
   * Player-initiated escape attempt (combat:condition:escape) — rolls `escapeSkillCheck` against
   * this hook's own `dc` and, on success, tears the hook down the same way a successful
   * saveToEnd does (unregister + clear the condition(s)). Returns null if this hook isn't
   * escape-capable at all, so the caller can tell "no such check" apart from "failed the check".
   */
  async attemptEscape(engine: StateEngine): Promise<{ succeeded: boolean; roll: number; bonus: number; total: number; dc: number } | null> {
    if (!this.escapeSkillCheck || this.dc === undefined) return null;
    const cid = engine.campaignId;
    const result = await rollSkillCheck(cid, this.ownerId, this.escapeSkillCheck, this.dc);
    if (result.succeeded) {
      engine.unregister(this.id);
      await this.clearConditions(cid);
    }
    return { ...result, dc: this.dc };
  }

  /** Tears this hook down outside its own apply()/attemptEscape() paths — Animal Friendship/Charm Person's "ends if the caster damages it" (checkEndsIfCasterDamages, runtime.ts). */
  async forceEnd(engine: StateEngine): Promise<void> {
    engine.unregister(this.id);
    await this.clearConditions(engine.campaignId);
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  async apply(_ctx: TurnContext, engine: StateEngine): Promise<void> {
    const cid = engine.campaignId;
    const participant = encounters.get(cid)?.findParticipant(this.ownerId);
    if (!participant || participant.isDead()) return;

    const dice = resolveSpellDamageDice(this.scaling, this.casterLevel, this.slotLevel, this.casterAbilityMod) ?? this.scaling?.base;
    if (dice) {
      const dmgCtx = await engine.trigger('beforeDamage', {
        sourceId: this.casterId,
        targetId: this.ownerId,
        targetName: participant.name,
        amount: rollDice(dice),
        damageType: this.damageType,
        sourceName: this.source,
      });
      if (dmgCtx.amount > 0) {
        console.log(`[hook] ${participant.name} takes ${dmgCtx.amount} ${this.damageType ?? ''} damage from ${this.source}`.replace('  ', ' '));
        if (participant.isPlayer) {
          await applyDamageToPlayer(cid, participant, dmgCtx.amount, { sourceId: this.casterId });
        } else {
          await applyDamageToCreature(cid, this.ownerId, dmgCtx.amount);
        }
        await engine.trigger('afterDamage', dmgCtx);
      }
    }

    const tempHpDice = resolveSpellDamageDice(this.tempHpScaling, this.casterLevel, this.slotLevel, this.casterAbilityMod) ?? this.tempHpScaling?.base;
    if (tempHpDice) {
      const amount = rollDice(tempHpDice);
      if (participant.isPlayer) grantTempHpToPlayer(cid, participant, amount);
      else participant.grantTempHp(amount);
      console.log(`[hook] ${participant.name} gains ${amount} temp HP from ${this.source}`);
    }

    if (!this.saveToEnd || this.dc === undefined) return;
    const { saved, roll, bonus, total } = await rollSavingThrow(cid, this.ownerId, this.saveToEnd.ability, this.dc);
    console.log(`[hook] ${participant.name} save vs ${this.source} DC${this.dc}: d20=${roll}${fmtMod(bonus)}=${total} — ${saved ? 'ENDS' : 'CONTINUES'}`);
    if (saved) {
      engine.unregister(this.id);
      await this.clearConditions(cid);
    }
  }
}
