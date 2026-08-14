import type { DamageContext, Spell, SpellSaveResult, CreatureType, AbilityKey, HookSpec } from 'shared';
import { CLASS_SPELLCASTING_ABILITY, statMod, effectApplies, parseRangeFeet } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';
import type { StateEngine } from '../StateEngine.ts';
import { encounters, tokenPositions, pendingWeaponBonuses, io, ROOM } from '../../../state.ts';
import { getCharacter } from '../../../storage.ts';
import { offerReaction } from '../reactionPrompt.ts';
import { trySpendSpellSlot, emitResources, applyDamageToCreature, applyDamageToPlayer, rollSavingThrow } from '../../runtime.ts';
import { rollApplicableDamage } from '../../dice.ts';
import { findSpell } from '../../../routes/spells.ts';
import { registerSpellHooks } from '../registerSpellHooks.ts';

/**
 * Interrupts damage resolution to offer its owner every "retaliate" reaction spell (Hellish
 * Rebuke, ...) currently eligible against whoever just damaged them, and applies whichever one
 * they pick.
 *
 * One broker per player, registered once at combat start — not one hook per spell — so a
 * player who knows more than one retaliate-shaped reaction sees them together in a single
 * sidebar offer instead of being asked about each spell in sequence.
 *
 * Sibling to ReactionOfferHook (Shield's shape: defend, before the hit lands, self-target) but
 * fundamentally different — this fires after damage has already landed, targets the attacker
 * rather than the owner, and resolves a save instead of nudging an AC check.
 */
export class RetaliationOfferHook extends Hook<'afterDamage'> {
  readonly stage = 'afterDamage' as const;

  constructor(props: HookProps) {
    super({ priority: 0, ...props });
  }

  matches(ctx: DamageContext): boolean {
    return ctx.targetId === this.ownerId && ctx.amount > 0 && ctx.sourceId !== this.ownerId;
  }

  async apply(ctx: DamageContext, engine: StateEngine): Promise<void> {
    const cid = engine.campaignId;
    const encounter = encounters.get(cid);
    const participant = encounter?.findParticipant(this.ownerId);
    if (!participant?.hasResource('reaction')) return;
    if (engine.hasHookOwnedBy(this.ownerId, 'reactionLock')) return;

    const attacker = encounter?.findParticipant(ctx.sourceId);
    if (!attacker || attacker.isDead()) return;

    const char = await getCharacter(cid, this.ownerId);
    if (!char) return;

    // RAW gates retaliation to "a creature within [range] of you" — Hellish Rebuke's Range: 60
    // feet is the trigger's own range check, not just where the resulting spell can land.
    // Positions are best-effort (grid tokens might not be placed yet in a test encounter), so a
    // missing position doesn't block the offer — only a confirmed out-of-range one does.
    const positions = tokenPositions.get(cid) ?? {};
    const ownerPos = positions[this.ownerId];
    const attackerPos = positions[attacker.id] ?? positions[attacker.name];
    const inRange = (spell: Spell): boolean => {
      const range = parseRangeFeet(spell.range);
      if (range <= 0 || range === Infinity || !ownerPos || !attackerPos) return true;
      const dist = Math.max(Math.abs(attackerPos.gx - ownerPos.gx), Math.abs(attackerPos.gy - ownerPos.gy)) * 5;
      return dist <= range;
    };

    // 'resist'-shaped spells (Absorb Elements) only trigger for a specific set of damage types —
    // "when you take acid, cold, fire, lightning, or thunder damage" — reusing onHit's
    // damageTypeOptions (the same field Chromatic Orb uses for its caster-pick list) as that set.
    // No list on the effect = no restriction (every 'retaliate' spell today has none).
    const triggerTypeAllowed = (spell: Spell): boolean => {
      const options = spell.combat?.onHit?.[0]?.damageTypeOptions;
      return !options || (!!ctx.damageType && options.includes(ctx.damageType));
    };

    const candidates: Spell[] = [];
    for (const name of char.spells ?? []) {
      const spell = findSpell(name);
      if (spell?.combat?.reactionTrigger?.on !== 'takingDamage') continue;
      if (inRange(spell) && triggerTypeAllowed(spell)) candidates.push(spell);
    }
    if (!candidates.length) return;

    const picked = await offerReaction(
      this.ownerId,
      candidates.map(spell => ({
        spellName: spell.name, kind: 'retaliate' as const,
        attackerName: attacker.name, sourceName: ctx.sourceName ?? attacker.name,
      })),
    );
    if (!picked) return;
    const spell = candidates.find(s => s.name === picked);
    if (!spell) return;

    // Re-check after the await — the player spent the whole window deciding.
    if (!encounters.get(cid) || !participant.hasResource('reaction') || attacker.isDead()) return;
    if (!(await trySpendSpellSlot(cid, this.ownerId, char, spell.level))) return;
    participant.trySpend('reaction');
    emitResources(participant);

    if (spell.combat?.reactionTrigger?.resolve === 'resist') {
      await this.resolveResist(spell, ctx, engine, char.level ?? 1);
      return;
    }

    const combat = spell.combat;
    const spellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
    const dc = 8 + (char.proficiencyBonus ?? 2) + statMod(char.stats[spellAbility]);
    const saveAbility: AbilityKey = combat?.save?.ability ?? spellAbility;
    const halfOnSave = combat?.save?.halfOnSave ?? false;

    const { saved, roll, bonus, total } = await rollSavingThrow(cid, attacker.id, saveAbility, dc);
    console.log(`[reaction] ${participant.name} retaliates with ${spell.name} — ${attacker.name} save vs DC${dc}: d20=${roll}+${bonus}=${total} — ${saved ? 'SAVE' : 'FAIL'}`);

    const targetType: CreatureType = attacker.isPlayer ? 'Humanoid' : (attacker.creature?.creatureType ?? 'Humanoid');
    const rolledDamage = rollApplicableDamage(combat?.onHit, targetType, char.level ?? 1, spell.level);

    let damage: number | undefined;
    if (rolledDamage && (!saved || halfOnSave)) {
      const dmgCtx = await engine.trigger('beforeDamage', {
        sourceId: this.ownerId, targetId: attacker.id, targetName: attacker.name,
        amount: saved ? Math.floor(rolledDamage.total / 2) : rolledDamage.total,
        damageType: rolledDamage.damageType, sourceName: spell.name,
      });
      damage = Math.max(0, dmgCtx.amount);
      if (attacker.isPlayer) {
        const attackerChar = await getCharacter(cid, attacker.id);
        if (attackerChar) await applyDamageToPlayer(cid, attacker, damage, { charId: attackerChar.id, sourceId: this.ownerId });
      } else {
        await applyDamageToCreature(cid, attacker.id, damage);
      }
      await engine.trigger('afterDamage', dmgCtx);
    }

    const result: SpellSaveResult = {
      casterName: participant.name,
      spellName: spell.name,
      dc,
      saveAbility,
      slotLevel: spell.level,
      outcomes: [{
        targetId: attacker.id,
        targetName: attacker.name,
        isPC: attacker.isPlayer,
        roll,
        saveBonus: bonus,
        total,
        dc,
        saved,
        damage,
        remainingHp: attacker.isPlayer ? attacker.currentHp : attacker.creature?.currentHp,
        targetDead: attacker.isDead(),
      }],
    };
    io.to(ROOM).emit('combat:spell:save:result', result);
  }

  /**
   * Absorb Elements' shape: resistance to the type that just hit you, until the start of your
   * next turn, plus your next weapon hit deals bonus damage of that same type.
   *
   * ponytail: Absorb Elements is the only spell that reacts to *whatever type just hit it* — the
   * damage type is read off ctx and injected into a HookSpec/EffectSpec built at runtime rather
   * than adding a "derive from trigger" field to the schema for one spell. Generalize the day a
   * second reactive-resistance spell shows up.
   */
  private async resolveResist(spell: Spell, ctx: DamageContext, engine: StateEngine, casterLevel: number): Promise<void> {
    const damageType = ctx.damageType;
    if (!damageType) return;
    const cid = engine.campaignId;

    const spec: HookSpec = {
      type: 'damageResistance',
      damageType,
      resistanceMode: 'resistance',
      duration: { until: 'startOfOwnerTurn' },
    };
    await registerSpellHooks(engine, [spec], spell.name, {
      ownerId: this.ownerId, casterId: this.ownerId, casterLevel, slotLevel: spell.level,
      currentRound: encounters.get(cid)?.currentRound?.number ?? 1,
    });

    const bonuses = pendingWeaponBonuses.get(cid) ?? {};
    bonuses[this.ownerId] = {
      spellName: spell.name,
      effects: (spell.combat?.onHit ?? []).map(e => ({ ...e, damageType })),
      casterLevel,
      slotLevel: spell.level,
    };
    pendingWeaponBonuses.set(cid, bonuses);
    console.log(`[reaction] ${this.ownerId} resists ${ctx.damageType} and arms bonus damage via ${spell.name}`);
  }
}
