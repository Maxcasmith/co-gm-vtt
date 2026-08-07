import type { TurnOrderEntry, Weapon, Spell, SpellAttackResult, SpellSaveOutcome, SpellSaveResult, CreatureType, Character } from 'shared';
import { CLASS_WEAPON_PROFS, CLASS_SPELLCASTING_ABILITY, CLASS_SAVING_THROWS, isAmmunition, statMod, parseRangeFeet, resolveForcedMovement, effectApplies } from 'shared';
import { getCharacter, updateCharacter, saveEncounter, listCharacters, getConfig, appendChatLog } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { generateCombatFlavour, generateSpellSaveFlavour } from '../session-processor/imagePrompts.ts';
import { Participant } from '../domain/encounter.ts';
import { logError } from '../logger.ts';
import { io, ROOM, combatState, encounters, tokenPositions, dungeons, playerSocketIds, pendingWeaponBonuses, enemiesReady, connected } from '../state.ts';
import { D20Roll, rollDice, fmtMod, rollApplicableDamage } from '../combat/dice.ts';
import { applyDamageToCreature, advanceTurn, trySpendSpellSlot, emitTurn } from '../combat/runtime.ts';
import { checkDungeonProximity } from '../dungeon/runtime.ts';
import type { JoinContext } from './context.ts';

export function registerCombatHandlers(ctx: JoinContext): void {
  const { socket, campaignId } = ctx;

  socket.on('token:move', ({ tokenId, gx, gy }) => {
    const positions = tokenPositions.get(campaignId) ?? {};
    positions[tokenId] = { gx, gy };
    tokenPositions.set(campaignId, positions);
    socket.to(ROOM).emit('token:moved', { tokenId, gx, gy });

    if (connected.has(tokenId)) void checkDungeonProximity(campaignId, gx, gy, tokenId);
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

    const expected = encounter.expectedParticipantCount;
    if (encounter.turnOrder.length >= expected && expected > 0 && !encounter.currentRound && enemiesReady.get(cid)) {
      encounter.beginCombat();
      emitTurn(cid);
    }
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

      const roll = new D20Roll({ withDisadvantage: inExtendedRange }).roll();
      const total = roll + attackBonus;
      const hit = total >= creature.ac;

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

        await applyDamageToCreature(cid, targetId, damage);
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
        ac: creature.ac,
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

      if (!(await trySpendSpellSlot(cid, casterId, char, slotLevel))) {
        const sid = playerSocketIds.get(casterId);
        if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
        return;
      }

      const spellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
      const abilityMod = statMod(char.stats[spellAbility]);
      const charProf = char.proficiencyBonus ?? 2;
      const attackBonus = abilityMod + charProf;

      const roll = new D20Roll().roll();
      const total = roll + attackBonus;
      const hit = total >= creature.ac;

      const rolledDamage = rollApplicableDamage(spell.combat?.onHit, creature.creatureType, char.level ?? 1, slotLevel);

      let damage: number | undefined;
      let damageRoll: number | undefined;
      if (hit && rolledDamage) {
        damageRoll = rolledDamage.total;
        damage = damageRoll; // no spellcasting-mod bonus on spell damage, per 5e rules
        await applyDamageToCreature(cid, targetId, damage);
      }

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
        ac: creature.ac,
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

      if (!(await trySpendSpellSlot(cid, casterId, char, slotLevel))) {
        const sid = playerSocketIds.get(casterId);
        if (sid) io.to(sid).emit('combat:attack:blocked', { reason: 'No spell slots left' });
        return;
      }

      const combat = spell.combat;

      // Self-buff spells with no save (Divine Smite, Divine Favor, Zephyr Strike, ...) don't
      // resolve now — they queue extra damage for this caster's next weapon hit this turn.
      // ponytail: curse-style buffs that mark an enemy target over a duration (Hex, Hunter's
      // Mark) need target-lock + duration tracking, a different shape — not handled here yet.
      if (!combat?.save && parseRangeFeet(spell.range) === 0 && targetIds.length === 1 && targetIds[0] === casterId) {
        const damageEffects = combat?.onHit?.filter(e => e.type === 'damage') ?? [];
        if (damageEffects.length) {
          const bonuses = pendingWeaponBonuses.get(cid) ?? {};
          bonuses[casterId] = { spellName: spell.name, effects: damageEffects, casterLevel: char.level ?? 1, slotLevel };
          pendingWeaponBonuses.set(cid, bonuses);
        }
        return;
      }

      const casterSpellAbility = CLASS_SPELLCASTING_ABILITY[char.class] ?? 'int';
      const casterAbilityMod = statMod(char.stats[casterSpellAbility]);
      const charProf = char.proficiencyBonus ?? 2;
      const dc = 8 + charProf + casterAbilityMod;

      const saveAbility = combat?.save?.ability ?? casterSpellAbility;
      const halfOnSave = combat?.save?.halfOnSave ?? false;

      const chars = await listCharacters(cid);
      const outcomes: SpellSaveOutcome[] = [];

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

        const roll = new D20Roll().roll();
        const total = roll + saveBonus;
        const saved = total >= dc;
        console.log(`[spell-save] ${participant.name} vs ${spell.name} DC${dc}: d20=${roll}${fmtMod(saveBonus)}=${total} — ${saved ? 'SAVE' : 'FAIL'}`);

        const targetType: CreatureType = participant.isPlayer ? 'Humanoid' : (participant.creature?.creatureType ?? 'Humanoid');
        const conditionEffects = (combat?.onHit ?? []).filter(e => e.type === 'condition' && effectApplies(e, targetType));
        const forcedMove = (combat?.onHit ?? []).find(e => (e.type === 'push' || e.type === 'pull') && effectApplies(e, targetType));

        let damage: number | undefined;
        const rolledDamage = rollApplicableDamage(combat?.onHit, targetType, char.level ?? 1, slotLevel);
        if (rolledDamage && (!saved || halfOnSave)) {
          damage = saved ? Math.floor(rolledDamage.total / 2) : rolledDamage.total;
          if (participant.isPlayer && targetChar) {
            participant.takeDamage(damage);
            void updateCharacter(cid, targetChar.id, c => ({ ...c, currentHp: participant.currentHp }));
            io.to(ROOM).emit('combat:player:damage', {
              characterId: targetChar.id, characterName: participant.name,
              damage, currentHp: participant.currentHp, maxHp: participant.maxHp,
            });
          } else if (participant.creature) {
            // Routes through the shared helper (same one combat:attack/combat:spell:attack
            // use) so a kill here also clears turn order and triggers the victory check —
            // calling participant.takeDamage directly here skipped both.
            await applyDamageToCreature(cid, targetId, damage);
          }
        }

        const conditionsApplied = !saved
          ? conditionEffects.map(e => e.condition).filter((c): c is NonNullable<typeof c> => !!c)
          : undefined;

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
