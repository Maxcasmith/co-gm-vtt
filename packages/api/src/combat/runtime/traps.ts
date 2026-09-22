import type { CreatureType, SpellSaveResult, TrapEffect } from 'shared';
import { saveDungeon, listCharacters } from '../../storage.ts';
import { toClientDungeon, broadcastDungeon } from '../../dungeon/index.ts';
import { Participant } from '../../domain/encounter.ts';
import { logDebug } from '../../logger.ts';
import { fightOf, toFightOf, playerSocketIds, dungeonOf, io } from '../../state.ts';
import { calcMaxHp, rollApplicableDamage } from '../dice.ts';
import { applyDamageToCreature, applyDamageToPlayer } from './damage.ts';
import { advanceTurn } from './lifecycle.ts';
import { rollSavingThrow } from './rolls.ts';
import { applyCondition } from './statusEffects.ts';
import { postChat } from '../../partyGroups.ts';

// Fallback only for a trap entity saved before manifest-authored traps carried real effect data
// (placer.ts now always populates entity.trap). No damage — guessing a lethal formula for a trap
// whose actual effect was never recorded is worse than under-reacting to it.
const DEFAULT_TRAP_EFFECT: TrapEffect = { effects: [] };

/**
 * The one trap-trigger listener, called from every place a token can step onto a trap's cell:
 * checkDungeonProximity (dungeon exploration and in-combat player movement both flow through
 * player token:move) and the AI movement loop below (enemy steps). Single-use — the trap is
 * removed from the dungeon the instant it springs, matching Snare and the "trap springs" trope.
 */
export async function checkTrapAt(cid: string, gx: number, gy: number, triggerId: string, triggerName: string, isPlayer: boolean): Promise<void> {
  const dungeon = dungeonOf(cid, isPlayer ? triggerName : triggerId);
  const entity = dungeon?.entities.find(e => {
    if (e.type !== 'trap') return false;
    const radius = e.trap?.radiusFt ?? 0;
    return Math.max(Math.abs(e.x - gx), Math.abs(e.y - gy)) * 5 <= radius;
  });
  if (!dungeon || !entity) return;

  const trapDef = entity.trap ?? DEFAULT_TRAP_EFFECT;

  // 'seal' traps aren't single-use in the usual sense — the consequence (a door sealed shut, an
  // alarm sounding) outlasts the trigger, so the entity stays in place with its hidden
  // escapeSkill/escapeDC intact for the DM's ground truth to keep reasoning about (see
  // describeDungeonGroundTruth's entityStatus). No save, no damage: just narrate the trigger, plain.
  if (trapDef.kind === 'seal') {
    entity.discovered = true;
    void saveDungeon(cid, dungeon);
    broadcastDungeon(cid, dungeon);
    const msg = { text: `${triggerName} triggers ${entity.name}!`, senderName: 'System', timestamp: Date.now() };
    void postChat(cid, msg, [isPlayer ? triggerName : triggerId]);
    logDebug(`[trap] ${entity.name} (seal) triggered by ${triggerName} at (${gx},${gy})`);
    return;
  }

  dungeon.entities = dungeon.entities.filter(e => e.id !== entity.id);
  void saveDungeon(cid, dungeon);
  broadcastDungeon(cid, dungeon);

  // Alert-only trap (Alarm) — no save, no effects, nothing to resolve. Notify just the caster
  // who set it rather than broadcasting a "triggers!" line to the whole table.
  if (!trapDef.save && trapDef.effects.length === 0) {
    const caster = entity.placedBy ? (await listCharacters(cid)).find(c => c.name === entity.placedBy) : undefined;
    const sid = caster ? playerSocketIds.get(caster.id) : undefined;
    if (sid) {
      io.to(sid).emit('chat:message', { text: `Your ${entity.name} alerts you — ${triggerName} passed through it.`, senderName: 'System', timestamp: Date.now() });
    }
    logDebug(`[trap] ${entity.name} (alert-only) triggered by ${triggerName} at (${gx},${gy}), notified ${entity.placedBy ?? 'nobody (unplaced)'}`);
    return;
  }

  let participant: Participant | undefined;
  let targetId = triggerId;

  if (isPlayer) {
    const char = (await listCharacters(cid)).find(c => c.name === triggerName);
    if (!char) return;
    targetId = char.id;
    participant = fightOf(cid, char.id)?.findParticipant(char.id) ?? new Participant({
      id: char.id, name: char.name, initiative: 0, isPlayer: true,
      currentHp: char.currentHp ?? calcMaxHp(char), maxHp: calcMaxHp(char), tempHp: char.tempHp ?? 0,
    });
  } else {
    participant = fightOf(cid, triggerId)?.findParticipant(triggerId);
    if (!participant) return;
  }

  logDebug(`[trap] ${triggerName} (isPlayer=${isPlayer}) steps on ${entity.name} at (${gx},${gy})`);
  let saved = false;
  let saveRoll: Awaited<ReturnType<typeof rollSavingThrow>> | undefined;
  if (trapDef.save) {
    const result = await rollSavingThrow(cid, targetId, trapDef.save.ability, trapDef.save.dc);
    saved = result.saved;
    saveRoll = result;
    console.log(`[trap] ${triggerName} triggers ${entity.name} — save vs DC${trapDef.save.dc}: ${saved ? 'SAVE' : 'FAIL'}`);
    logDebug(`[trap] ${triggerName} triggers ${entity.name} — save vs DC${trapDef.save.dc}: ${saved ? 'SAVE' : 'FAIL'}`);
  }

  const targetType: CreatureType = isPlayer ? 'Humanoid' : (participant.creature?.creatureType ?? 'Humanoid');
  const rolledDamage = rollApplicableDamage(trapDef.effects, targetType, 1, 1);
  let damage: number | undefined;
  if (rolledDamage && (!saved || trapDef.save?.halfOnSave)) {
    damage = saved ? Math.floor(rolledDamage.total / 2) : rolledDamage.total;
    if (isPlayer) await applyDamageToPlayer(cid, participant, damage, { charId: targetId });
    else await applyDamageToCreature(cid, targetId, damage);
  }

  const conditionsApplied: string[] = [];
  if (!saved) {
    for (const effect of trapDef.effects) {
      if (effect.type === 'condition' && effect.condition) {
        await applyCondition(cid, targetId, effect.condition);
        conditionsApplied.push(effect.condition);
      }
    }
  }

  const msg = { text: `${triggerName} triggers ${entity.name}!`, senderName: 'System', timestamp: Date.now(), breakdown: saveRoll?.breakdown };
  void postChat(cid, msg, [isPlayer ? triggerName : triggerId]);

  // Reuses the same SpellSaveResult broadcast every other save-based spell renders through the
  // combat log — a trap's save roll should be just as visible as Snare's DC was when it was cast.
  if (saveRoll && trapDef.save) {
    const result: SpellSaveResult = {
      casterName: entity.placedBy ?? entity.name,
      spellName: entity.name,
      dc: trapDef.save.dc,
      saveAbility: trapDef.save.ability,
      slotLevel: 1,
      outcomes: [{
        targetId, targetName: triggerName, isPC: isPlayer,
        roll: saveRoll.roll, breakdown: saveRoll.breakdown, total: saveRoll.total, dc: trapDef.save.dc,
        saved, damage,
        conditionsApplied: conditionsApplied.length ? conditionsApplied : undefined,
        remainingHp: isPlayer ? participant.currentHp : participant.creature?.currentHp,
        targetDead: participant.isDead(),
      }],
    };
    toFightOf(cid, targetId).emit('combat:spell:save:result', result);
  }
}

