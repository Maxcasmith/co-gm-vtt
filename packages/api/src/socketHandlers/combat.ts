import type { TurnOrderEntry, Weapon, Spell, SpellAttackResult, SpellSaveOutcome, SpellSaveResult, CreatureType, Character, ActionResource, AttackContext } from 'shared';
import { CLASS_WEAPON_PROFS, CLASS_SPELLCASTING_ABILITY, CLASS_SAVING_THROWS, isAmmunition, statMod, parseRangeFeet, resolveForcedMovement, effectApplies, actionCostFromCastingTime, requiresConcentration } from 'shared';
import { getCharacter, updateCharacter, saveEncounter, listCharacters, getConfig, appendChatLog } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateCombatFlavour, generateSpellSaveFlavour } from '../session-processor/imagePrompts.ts';
import { Participant } from '../domain/encounter.ts';
import { logError } from '../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, dungeons, playerSocketIds, pendingWeaponBonuses, connected, getStateEngine } from '../state.ts';
import { registerSpellHooks } from '../combat/stateEngine/registerSpellHooks.ts';
import { resolveReaction } from '../combat/stateEngine/reactionPrompt.ts';
import { D20Roll, rollDice, fmtMod, rollApplicableDamage } from '../combat/dice.ts';
import { rollModeFor } from '../combat/conditions/rollModeFor.ts';
import { applyDamageToCreature, applyDamageToPlayer, advanceTurn, trySpendSpellSlot, tryBeginCombat, emitResources, applyCondition, clearCondition, startConcentrating, isConcentratingOn } from '../combat/runtime.ts';
import { checkDungeonProximity } from '../dungeon/runtime.ts';
import type { JoinContext } from './context.ts';

/**
 * Spends one of the actor's per-turn resources, telling them why if they have none left.
 * Returns false when the action must not proceed.
 *
 * Only gates the participant whose turn it is — a reaction spent on someone else's turn goes
 * through ReactionOfferHook, which does its own check against the same budget.
 */
function trySpendAction(cid: string, actorId: string, kind: ActionResource): boolean {
  const participant = encounters.get(cid)?.findParticipant(actorId);
  if (!participant) return true; // not tracked in this encounter — don't block on missing state
  if (participant.trySpend(kind)) {
    emitResources(participant);
    return true;
  }
  const sid = playerSocketIds.get(actorId);
  const label = kind === 'bonusAction' ? 'bonus action' : kind;
  if (sid) io.to(sid).emit('combat:attack:blocked', { reason: `No ${label} left this turn` });
  return false;
}

export function registerCombatHandlers(ctx: JoinContext): void {
  const { socket, campaignId } = ctx;

  socket.on('token:move', ({ tokenId, gx, gy }) => {
    const positions = tokenPositions.get(campaignId) ?? {};
    positions[tokenId] = { gx, gy };
    tokenPositions.set(campaignId, positions);
    socket.to(ROOM).emit('token:moved', { tokenId, gx, gy });

    if (connected.has(tokenId)) void checkDungeonProximity(campaignId, gx, gy, tokenId);
  });

  // Manual GM-driven condition control — traps, cures, anything outside the spell-save path
  // that already applies conditions on a failed save. Works on players and creatures, in or
  // out of combat (see applyCondition/clearCondition in runtime.ts for target resolution).
  socket.on('combat:condition:add', ({ targetId, name }) => {
    void applyCondition(campaignId, targetId, name);
  });

  socket.on('combat:condition:remove', ({ targetId, name }) => {
    void clearCondition(campaignId, targetId, name);
  });

  socket.on('combat:initiative:roll', (entry: TurnOrderEntry) => {
    const cid = campaignId;
    if (!combatState.get(cid)) return;
    const encounter = encounters.get(cid);
    if (!encounter) return;

    let participant = encounter.findParticipant(entry.id);
    if (!participant) {
      encounter.expectedParticipantCount++;
      participant = new Participant({
        id: entry.id,
        name: entry.name,
        initiative: entry.initiative,
        isPlayer: entry.isPlayer,
      });
    } else {
      participant.initiative = entry.initiative;
    }

    encounter.addToTurnOrder(participant);
    io.to(ROOM).emit('combat:initiative', entry);
    tryBeginCombat(cid);
    void saveEncounter(cid, encounter);
  });

  socket.on('combat:attack', ({ attackerId, attackerName, targetId, weapon, bonusSpell }: { attackerId: string; attackerName: string; targetId: string; weapon: Weapon; bonusSpell?: Spell }) => {
    void (async () => {
      const cid = campaignId;
      if (!combatState.get(cid)) return;
      const encounter = encounters.get(cid);
      if (!encounter) return;

      const char = await getCharacter(cid, attackerId);
      const creature = encounter.findCreature(targetId);
      if (!char || !creature || creature.isDead()) return;

      // An attack costs the action; a bundled smite costs the bonus action on top. Spent before
      // ammunition is deducted so a blocked attack cannot silently eat an arrow.
      if (!trySpendAction(cid, attackerId, 'action')) return;
      if (bonusSpell && !trySpendAction(cid, attackerId, 'bonusAction')) return;

      if (weapon.ammoSlug) {
        const ammo = char.inventory?.find(i => isAmmunition(i) && i.usableBySlug === weapon.ammoSlug && i.quantity > 0);
        if (!ammo) {
          const sid = playerSocketIds.get(attackerId);
          if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No arrows left' });
          return;
        }
        const quantity = ammo.quantity - 1;
        await updateCharacter(cid, attackerId, c => ({
          ...c,
          inventory: quantity > 0
            ? (c.inventory ?? []).map(i => i.id === ammo.id ? { ...i, quantity } : i)
            : (c.inventory ?? []).filter(i => i.id !== ammo.id),
        }));
        const sid = playerSocketIds.get(attackerId);
        if (sid) io.to(sid).emit('character:inventory:remove', { itemId: ammo.id, quantity: Math.max(0, quantity) });
      }

      const strMod = statMod(char.stats.str);
      const dexMod = statMod(char.stats.dex);
      const isMelee = weapon.range <= 10; // covers reach weapons (e.g. Whip, range 10) — next tier up is bows at 80+
      const useDex = !isMelee || (weapon.isFinesse && dexMod > strMod);
      const statBonus = useDex ? dexMod : strMod;
      const statName = useDex ? 'Dexterity' : 'Strength';
      const charProf = char.proficiencyBonus ?? 2;
      const classWeaponProfs = CLASS_WEAPON_PROFS[char.class] ?? [];
      const isProficient = weapon.properties?.some(p => classWeaponProfs.includes(p as 'simple' | 'martial'));
      const weaponBonus = (weapon.attackBonus ?? 0) + (isProficient ? charProf : 0);
      const attackBonus = statBonus + weaponBonus;

      const positions = tokenPositions.get(cid) ?? {};
      const attackerPos = positions[attackerName];
      const targetPos = positions[targetId];
      const inExtendedRange = !!(weapon.extendedRange && attackerPos && targetPos &&
        Math.max(Math.abs(targetPos.gx - attackerPos.gx), Math.abs(targetPos.gy - attackerPos.gy)) > Math.floor(weapon.range / 5));

      const mode = rollModeFor(char, 'attack');
      const roll = new D20Roll({ withDisadvantage: inExtendedRange || mode < 0, withAdvantage: mode > 0 }).roll();
      const engine = getStateEngine(cid);
      const atkCtx = await engine.trigger('afterAttackRoll', await engine.trigger('beforeAttackRoll', {
        attackerId, attackerName,
        targetId, targetName: creature.name,
        targetIsPlayer: false,
        sourceName: weapon.name,
        d20: roll,
        attackBonus,
        ac: creature.ac,
        total: roll + attackBonus,
        hit: roll + attackBonus >= creature.ac,
      }));
      if (!combatState.get(cid)) return;

      // Re-derived from the context rather than the pre-hook locals — see CONTEXT MUTATION in
      // shared/types/combat-hooks.ts.
      const total = atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
      const hit = atkCtx.hit = total >= atkCtx.ac;

      let damage: number | undefined;
      let damageRoll: number | undefined;
      let bonus: { spellName: string; damageType: string | undefined; total: number } | undefined;
      if (hit) {
        damageRoll = rollDice(weapon.damage);
        damage = damageRoll + statBonus;

        // Divine-Smite-style bonus damage, evaluated against this actual target so appliesIf
        // (vs Fiend/Undead, ...) can gate it. Either bundled directly onto this attack (the
        // client sends both action + bonus action together for one-shot Instantaneous smites),
        // or queued earlier by a separate cast (Divine Favor/Zephyr Strike-style duration buffs).
        if (bonusSpell) {
          // ponytail: bundled smite doesn't carry a slotLevel (no upcast picker on this
          // path) or consume a tracked slot yet — falls back to the spell's own level.
          const rolled = rollApplicableDamage(bonusSpell.combat?.onHit, creature.creatureType, char.level ?? 1, bonusSpell.level);
          if (rolled) {
            bonus = { spellName: bonusSpell.name, damageType: rolled.damageType, total: rolled.total };
            damage += rolled.total;
          }
        } else {
          const bonuses = pendingWeaponBonuses.get(cid);
          const pending = bonuses?.[attackerId];
          if (pending) {
            delete bonuses![attackerId];
            const rolled = rollApplicableDamage(pending.effects, creature.creatureType, pending.casterLevel, pending.slotLevel);
            if (rolled) {
              bonus = { spellName: pending.spellName, damageType: rolled.damageType, total: rolled.total };
              damage += rolled.total;
            }
          }
        }

        const dmgCtx = await engine.trigger('beforeDamage', {
          sourceId: attackerId, targetId, targetName: creature.name,
          amount: damage, damageType: weapon.damageType, sourceName: weapon.name,
        });
        damage = Math.max(0, dmgCtx.amount);
        await applyDamageToCreature(cid, targetId, damage);
        await engine.trigger('afterDamage', dmgCtx);
      }

      const atkResult = {
        attackerName,
        targetName: creature.name,
        targetId,
        weaponName: weapon.name,
        d20: roll,
        attackBonus,
        statBonus,
        statName,
        weaponBonus,
        total,
        ac: atkCtx.ac,
        hit,
        damage,
        damageRoll,
        damageType: weapon.damageType,
        damageFormula: weapon.damage,
        bonusSpellName: bonus?.spellName,
        bonusDamage: bonus?.total,
        bonusDamageType: bonus?.damageType,
        remainingHp: hit ? encounter.findCreature(targetId)?.currentHp : undefined,
        targetDead: encounter.findCreature(targetId)?.isDead() ?? false,
      };
      io.to(ROOM).emit('combat:attack:result', atkResult);

      void (async () => {
        try {
          const config = await getConfig();
          if (!hasFeatureProvider(config, 'combatNarration')) return;
          const flavour = await generateCombatFlavour(atkResult, getFeatureProvider(config, 'combatNarration'));
          if (!flavour) return;
          const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
          await appendChatLog(cid, msg);
          io.to(ROOM).emit('chat:message', msg);
        } catch (err) { logError('index:combatFlavour', err); }
      })();
    })();
  });

  // Single-target spell attack (e.g. Fire Bolt) — mirrors combat:attack but uses the
  // caster's spellcasting modifier for the attack roll and adds no stat mod to damage.
  socket.on('combat:spell:attack', ({ casterId, casterName, targetId, spell, slotLevel }) => {
    void (async () => {
      const cid = campaignId;
      if (!combatState.get(cid)) return;
      const encounter = encounters.get(cid);
      if (!encounter) return;

      const char = await getCharacter(cid, casterId);
      const creature = encounter.findCreature(targetId);
      if (!char || !creature || creature.isDead()) return;

      // Reaction-cast spells are never initiated from here — they are offered mid-resolution by
      // ReactionOfferHook, which spends the reaction itself.
      const castCost = actionCostFromCastingTime(spell.castingTime);
      if (castCost && castCost !== 'reaction' && !trySpendAction(cid, casterId, castCost)) return;

      // Redirecting an already-sustained spell (Witch Bolt) is free — no slot, per RAW.
      const free = await isConcentratingOn(cid, casterId, spell.name);
      if (!free && !(await trySpendSpellSlot(cid, casterId, char, slotLevel))) {
        const sid = playerSocketIds.get(casterId);
        if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
        return;
      }

      const spellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
      const abilityMod = statMod(char.stats[spellAbility]);
      const charProf = char.proficiencyBonus ?? 2;
      const attackBonus = abilityMod + charProf;

      const engine = getStateEngine(cid);
      await engine.trigger('beforeSpellCast', {
        casterId, casterName, spellName: spell.name,
        spellLevel: spell.level, slotLevel, targetIds: [targetId],
      });

      // Redirecting an already-sustained spell (Witch Bolt) auto-hits, no roll — only the
      // initial slotted cast is a real attack roll that can miss.
      let roll = 0;
      let atkCtx: AttackContext;
      let total: number;
      let hit: boolean;
      if (free) {
        atkCtx = {
          attackerId: casterId, attackerName: casterName,
          targetId, targetName: creature.name, targetIsPlayer: false,
          sourceName: spell.name, d20: 0, attackBonus, ac: creature.ac,
          total: attackBonus, hit: true,
        };
        total = attackBonus;
        hit = true;
      } else {
        const spellMode = rollModeFor(char, 'attack');
        roll = new D20Roll({ withDisadvantage: spellMode < 0, withAdvantage: spellMode > 0 }).roll();
        atkCtx = await engine.trigger('afterAttackRoll', await engine.trigger('beforeAttackRoll', {
          attackerId: casterId, attackerName: casterName,
          targetId, targetName: creature.name,
          targetIsPlayer: false,
          sourceName: spell.name,
          d20: roll,
          attackBonus,
          ac: creature.ac,
          total: roll + attackBonus,
          hit: roll + attackBonus >= creature.ac,
        }));
        if (!combatState.get(cid)) return;

        total = atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
        hit = atkCtx.hit = total >= atkCtx.ac;
      }

      const rolledDamage = rollApplicableDamage(spell.combat?.onHit, creature.creatureType, char.level ?? 1, slotLevel);

      let damage: number | undefined;
      let damageRoll: number | undefined;
      if (hit && rolledDamage) {
        damageRoll = rolledDamage.total;
        const dmgCtx = await engine.trigger('beforeDamage', {
          sourceId: casterId, targetId, targetName: creature.name,
          amount: damageRoll, // no spellcasting-mod bonus on spell damage, per 5e rules
          damageType: rolledDamage.damageType, sourceName: spell.name,
        });
        damage = Math.max(0, dmgCtx.amount);
        await applyDamageToCreature(cid, targetId, damage);
        await engine.trigger('afterDamage', dmgCtx);
      }

      if (hit) {
        registerSpellHooks(engine, spell, {
          ownerId: targetId, casterId, casterLevel: char.level ?? 1, slotLevel,
          currentRound: encounter.currentRound?.number ?? 1,
        });
      }
      if (requiresConcentration(spell)) {
        await startConcentrating(cid, casterId, spell.name, hit ? [targetId] : []);
      }
      await engine.trigger('afterSpellCast', {
        casterId, casterName, spellName: spell.name,
        spellLevel: spell.level, slotLevel, targetIds: [targetId],
      });

      const atkResult: SpellAttackResult = {
        attackerName: casterName,
        targetName: creature.name,
        targetId,
        spellName: spell.name,
        d20: roll,
        attackBonus,
        statBonus: abilityMod,
        statName: 'Spellcasting',
        total,
        ac: atkCtx.ac,
        hit,
        damage,
        damageRoll,
        damageType: rolledDamage?.damageType,
        damageFormula: rolledDamage?.formula,
        remainingHp: hit ? encounter.findCreature(targetId)?.currentHp : undefined,
        targetDead: encounter.findCreature(targetId)?.isDead() ?? false,
      };
      io.to(ROOM).emit('combat:spell:attack:result', atkResult);

      void (async () => {
        try {
          const config = await getConfig();
          if (!hasFeatureProvider(config, 'combatNarration')) return;
          const flavour = await generateCombatFlavour(atkResult, getFeatureProvider(config, 'combatNarration'));
          if (!flavour) return;
          const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
          await appendChatLog(cid, msg);
          io.to(ROOM).emit('chat:message', msg);
        } catch (err) { logError('index:combatFlavour', err); }
      })();
    })();
  });

  // Save-based spell (single-target or AoE) — computes the DC once, then rolls each
  // affected target's save mechanically and applies damage/conditions behind the curtain.
  socket.on('combat:spell:cast', ({ casterId, casterName, spell, slotLevel, targetIds }) => {
    void (async () => {
      const cid = campaignId;
      if (!combatState.get(cid)) return;
      const encounter = encounters.get(cid);
      if (!encounter) return;

      const char = await getCharacter(cid, casterId);
      if (!char) return;

      const castCost = actionCostFromCastingTime(spell.castingTime);
      if (castCost && castCost !== 'reaction' && !trySpendAction(cid, casterId, castCost)) return;

      // Redirecting an already-sustained spell (Hunter's Mark, Witch Bolt) is free — no slot, per RAW.
      const free = await isConcentratingOn(cid, casterId, spell.name);
      if (!free && !(await trySpendSpellSlot(cid, casterId, char, slotLevel))) {
        const sid = playerSocketIds.get(casterId);
        if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
        return;
      }

      const combat = spell.combat;

      // Self-buff spells with no save (Divine Smite, Divine Favor, Zephyr Strike, ...) don't
      // resolve now — they queue extra damage for this caster's next weapon hit this turn.
      // ponytail: curse-style buffs that mark an enemy target over a duration (Hex, Hunter's
      // Mark) need target-lock + duration tracking, a different shape — not handled here yet.
      // Also: self-buff concentration spells (Antimagic Field, Arcane Eye, ...) return here
      // without starting concentration — fine today since none of them have `hooks` declared
      // (only Shield/Caustic Brew do), so there's nothing yet for losing concentration to tear
      // down. Wire startConcentrating in here too the day one of them gets hooks.
      if (!combat?.save && parseRangeFeet(spell.range) === 0 && targetIds.length === 1 && targetIds[0] === casterId) {
        const damageEffects = combat?.onHit?.filter(e => e.type === 'damage') ?? [];
        if (damageEffects.length) {
          const bonuses = pendingWeaponBonuses.get(cid) ?? {};
          bonuses[casterId] = { spellName: spell.name, effects: damageEffects, casterLevel: char.level ?? 1, slotLevel };
          pendingWeaponBonuses.set(cid, bonuses);
        }
        return;
      }

      const engine = getStateEngine(cid);

      // No attack roll, no save — the target is simply marked (Hunter's Mark, Hex). Registers
      // whatever hooks the spell declares onto the caster (not the target) and links
      // concentration to the caster's own ownerId, so a broken save/attack path never applies.
      if (combat?.autoHit) {
        const targetId = targetIds[0];
        if (!targetId) return;
        const participant = encounter.findParticipant(targetId);
        if (!participant || participant.isDead()) return;

        if (combat?.hooks?.length) {
          registerSpellHooks(engine, spell, {
            ownerId: casterId, markedTargetId: targetId, casterId,
            casterLevel: char.level ?? 1, slotLevel,
            currentRound: encounter.currentRound?.number ?? 1,
          });
        }

        // Instant auto-hit damage on the spot (Witch Bolt) — no roll, applies immediately rather
        // than waiting on a hook, so redirecting to a new target each activation needs no persistent
        // mark to track.
        const targetType: CreatureType = participant.isPlayer ? 'Humanoid' : (participant.creature?.creatureType ?? 'Humanoid');
        const rolledDamage = rollApplicableDamage(combat?.onHit, targetType, char.level ?? 1, slotLevel);
        if (rolledDamage) {
          const dmgCtx = await engine.trigger('beforeDamage', {
            sourceId: casterId, targetId, targetName: participant.name,
            amount: rolledDamage.total, damageType: rolledDamage.damageType, sourceName: spell.name,
          });
          const damage = Math.max(0, dmgCtx.amount);
          if (participant.isPlayer) {
            await applyDamageToPlayer(cid, participant, damage, { sourceId: casterId });
          } else if (participant.creature) {
            await applyDamageToCreature(cid, targetId, damage);
          }
          await engine.trigger('afterDamage', dmgCtx);
        }

        if (requiresConcentration(spell)) {
          await startConcentrating(cid, casterId, spell.name, [casterId]);
        }
        const verb = rolledDamage ? 'hits' : 'marks';
        console.log(`[spell-mark] ${casterName} ${verb} ${participant.name} with ${spell.name}`);
        const msg = { text: `${casterName} ${verb} ${participant.name} with ${spell.name}.`, senderName: 'System', timestamp: Date.now() };
        void appendChatLog(cid, msg);
        io.to(ROOM).emit('chat:message', msg);
        return;
      }

      await engine.trigger('beforeSpellCast', {
        casterId, casterName, spellName: spell.name,
        spellLevel: spell.level, slotLevel, targetIds,
      });

      const casterSpellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
      const casterAbilityMod = statMod(char.stats[casterSpellAbility]);
      const charProf = char.proficiencyBonus ?? 2;
      const dc = 8 + charProf + casterAbilityMod;

      const saveAbility = combat?.save?.ability ?? casterSpellAbility;
      const halfOnSave = combat?.save?.halfOnSave ?? false;

      const chars = await listCharacters(cid);
      const outcomes: SpellSaveOutcome[] = [];
      const hookedTargetIds: string[] = [];

      for (const targetId of targetIds) {
        const participant = encounter.findParticipant(targetId);
        if (!participant || participant.isDead()) continue;

        let saveBonus: number;
        let targetChar: Character | undefined;
        if (participant.isPlayer) {
          targetChar = chars.find(c => c.id === targetId || c.name === participant.name);
          if (!targetChar) continue;
          const mod = statMod(targetChar.stats[saveAbility]);
          const classSaves: readonly string[] = CLASS_SAVING_THROWS[targetChar.class] ?? [];
          const proficient = classSaves.includes(saveAbility);
          saveBonus = mod + (proficient ? (targetChar.proficiencyBonus ?? 2) : 0);
        } else {
          saveBonus = participant.creature ? statMod(participant.creature.stats[saveAbility]) : 0;
        }

        const saveMode = rollModeFor(targetChar ?? participant.creature ?? {}, 'save', saveAbility);
        const d20 = new D20Roll({ withDisadvantage: saveMode < 0, withAdvantage: saveMode > 0 }).roll();
        const saveCtx = await engine.trigger('beforeSave', {
          casterId, targetId, targetName: participant.name,
          targetIsPlayer: participant.isPlayer,
          spellName: spell.name,
          ability: saveAbility,
          dc,
          d20,
          saveBonus,
          total: d20 + saveBonus,
          saved: d20 + saveBonus >= dc,
        });
        if (!combatState.get(cid)) return;

        // Re-derived from the context, so a hook that moved the DC or the bonus is reflected
        // before afterSave (and everything downstream) reads the outcome.
        saveCtx.total = saveCtx.d20 + saveCtx.saveBonus;
        saveCtx.saved = saveCtx.total >= saveCtx.dc;
        await engine.trigger('afterSave', saveCtx);

        const roll = saveCtx.d20;
        const total = saveCtx.total;
        const saved = saveCtx.saved;
        console.log(`[spell-save] ${participant.name} vs ${spell.name} DC${saveCtx.dc}: d20=${roll}${fmtMod(saveCtx.saveBonus)}=${total} — ${saved ? 'SAVE' : 'FAIL'}`);

        const targetType: CreatureType = participant.isPlayer ? 'Humanoid' : (participant.creature?.creatureType ?? 'Humanoid');
        const conditionEffects = (combat?.onHit ?? []).filter(e => e.type === 'condition' && effectApplies(e, targetType));
        const forcedMove = (combat?.onHit ?? []).find(e => (e.type === 'push' || e.type === 'pull') && effectApplies(e, targetType));

        let damage: number | undefined;
        const rolledDamage = rollApplicableDamage(combat?.onHit, targetType, char.level ?? 1, slotLevel);
        if (rolledDamage && (!saved || halfOnSave)) {
          const dmgCtx = await engine.trigger('beforeDamage', {
            sourceId: casterId, targetId, targetName: participant.name,
            amount: saved ? Math.floor(rolledDamage.total / 2) : rolledDamage.total,
            damageType: rolledDamage.damageType, sourceName: spell.name,
          });
          damage = Math.max(0, dmgCtx.amount);

          // Both branches go through the shared appliers so a kill here clears turn order,
          // triggers the victory check, and fires onDown/onKill — the player branch used to
          // inline its own HP write and skipped all three.
          if (participant.isPlayer && targetChar) {
            await applyDamageToPlayer(cid, participant, damage, { charId: targetChar.id, sourceId: casterId });
          } else if (participant.creature) {
            await applyDamageToCreature(cid, targetId, damage);
          }
          await engine.trigger('afterDamage', dmgCtx);
        }

        const conditionsApplied = !saved
          ? conditionEffects.map(e => e.condition).filter((c): c is NonNullable<typeof c> => !!c)
          : undefined;

        if (conditionsApplied?.length) {
          for (const name of conditionsApplied) await applyCondition(cid, targetId, name);
        }

        // Lingering effects attach to whoever failed — Tasha's Caustic Brew coating a creature
        // in acid that ticks at the start of each of its turns until the spell ends.
        if (!saved && combat?.hooks?.length) {
          registerSpellHooks(engine, spell, {
            ownerId: targetId,
            casterId,
            casterLevel: char.level ?? 1,
            slotLevel,
            currentRound: encounter.currentRound?.number ?? 1,
          });
          hookedTargetIds.push(targetId);
        }

        if (!saved && forcedMove?.distance) {
          const positions = tokenPositions.get(cid) ?? {};
          const casterPos = positions[casterName] ?? positions[casterId];
          const targetKey = positions[targetId] ? targetId : participant.name;
          const targetPos = positions[targetKey];
          if (casterPos && targetPos) {
            const dungeon = dungeons.get(cid);
            const occupied = new Set(
              Object.entries(positions)
                .filter(([id]) => id !== targetKey)
                .map(([, p]) => `${p.gx},${p.gy}`),
            );
            const moved = resolveForcedMovement(
              dungeon?.cells, occupied, targetPos.gx, targetPos.gy, casterPos.gx, casterPos.gy,
              forcedMove.distance, forcedMove.type === 'pull' ? 'pull' : 'push',
            );
            if (moved.gx !== targetPos.gx || moved.gy !== targetPos.gy) {
              positions[targetKey] = moved;
              tokenPositions.set(cid, positions);
              io.to(ROOM).emit('token:moved', { tokenId: targetKey, gx: moved.gx, gy: moved.gy });
            }
          }
        }

        outcomes.push({
          targetId,
          targetName: participant.name,
          isPC: participant.isPlayer,
          roll,
          saveBonus,
          total,
          dc,
          saved,
          damage,
          conditionsApplied,
          remainingHp: participant.isPlayer ? participant.currentHp : participant.creature?.currentHp,
          targetDead: participant.isDead(),
        });
      }

      if (requiresConcentration(spell)) {
        await startConcentrating(cid, casterId, spell.name, hookedTargetIds);
      }

      const result: SpellSaveResult = { casterName, spellName: spell.name, dc, saveAbility, slotLevel: spell.level, outcomes };
      io.to(ROOM).emit('combat:spell:save:result', result);

      if (outcomes.length) {
        void (async () => {
          try {
            const config = await getConfig();
            if (!hasFeatureProvider(config, 'combatNarration')) return;
            const flavour = await generateSpellSaveFlavour(result, getFeatureProvider(config, 'combatNarration'));
            if (!flavour) return;
            const msg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
            await appendChatLog(cid, msg);
            io.to(ROOM).emit('chat:message', msg);
          } catch (err) { logError('index:combatFlavour', err); }
        })();
      }
    })();
  });

  socket.on('combat:reaction:respond', ({ requestId, accepted }) => {
    resolveReaction(requestId, accepted);
  });

  socket.on('combat:turn:end', () => {
    const encounter = encounters.get(campaignId);
    const actor = encounter?.currentActor;
    console.log(`[turn] combat:turn:end received — currentActor=${actor?.name ?? 'none'} isPlayer=${actor?.isPlayer}`);
    if (actor?.isPlayer) {
      // Unused on-hit buffs (e.g. Divine Smite) expire if not spent by end of turn.
      delete pendingWeaponBonuses.get(campaignId)?.[actor.id];
      advanceTurn(campaignId);
    }
  });
}
