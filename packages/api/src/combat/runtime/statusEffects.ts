import type { Condition as ConditionName, ActiveCondition } from 'shared';
import { getCharacter, updateCharacter, saveEncounter } from '../../storage.ts';
import { logDebug } from '../../logger.ts';
import { io, campaignRoom, fightOf, getStateEngine } from '../../state.ts';
import { addCondition, removeCondition } from '../conditions/rollModeFor.ts';
import type { SanctuaryWardHook } from '../stateEngine/hooks/SanctuaryWardHook.ts';
import type { ConditionImmunityHook } from '../stateEngine/hooks/ConditionImmunityHook.ts';
import { breakConcentration } from './concentration.ts';
import { canMove } from './movement.ts';
import { rollSavingThrow, emitCombatRoll } from './rolls.ts';
import { postChat } from '../../partyGroups.ts';

/**
 * Resolves targetId to whoever holds its live conditions array — a creature or player mid-combat
 * (checked via the live encounter first), or a plain character lookup so conditions still work
 * outside combat — e.g. poisoned by a trap between fights. Every condition mutator (add/remove,
 * concentration) goes through this so there's one place that knows how to find + persist either kind.
 */
export async function conditionsHolder(cid: string, targetId: string): Promise<
  | { label: string; conditions: ActiveCondition[] | undefined; write: (c: ActiveCondition[]) => void }
  | undefined
> {
  const encounter = fightOf(cid, targetId);
  const participant = encounter?.findParticipant(targetId);

  if (participant?.creature) {
    const creature = participant.creature;
    return {
      label: participant.name,
      conditions: creature.conditions,
      write: c => { creature.conditions = c; if (encounter) void saveEncounter(cid, encounter); },
    };
  }

  const charId = participant?.id ?? targetId;
  const char = await getCharacter(cid, charId);
  if (!char) return undefined;
  return {
    label: char.name,
    conditions: char.conditions,
    write: c => { void updateCharacter(cid, charId, cur => ({ ...cur, conditions: c })); },
  };
}

async function setCondition(
  cid: string, targetId: string, name: ConditionName, fn: typeof addCondition,
): Promise<string | undefined> {
  const holder = await conditionsHolder(cid, targetId);
  if (!holder) return undefined;
  const conditions = fn(holder.conditions, name);
  holder.write(conditions);
  io.to(campaignRoom(cid)).emit('character:condition:update', { targetId, conditions });
  return holder.label;
}

export async function applyCondition(cid: string, targetId: string, name: ConditionName): Promise<void> {
  const immune = (getStateEngine(cid).getHooksOwnedBy(targetId, 'conditionImmunity') as ConditionImmunityHook[])
    .some(h => h.immuneConditions.includes(name));
  if (immune) return;

  const label = await setCondition(cid, targetId, name, addCondition);
  if (!label) return;
  console.log(`[condition] ${label} gains ${name}`);
  const msg = { text: `${label} is now ${name}.`, senderName: 'System', timestamp: Date.now() };
  void postChat(cid, msg, [targetId]);
  // 5e: incapacitated ends concentration outright, no save.
  if (name === 'Incapacitated') await breakConcentration(cid, targetId);
}

export async function clearCondition(cid: string, targetId: string, name: ConditionName): Promise<void> {
  // Concentrating carries linked hooks that need tearing down, not just the marker removed.
  if (name === 'Concentrating') return breakConcentration(cid, targetId);

  const label = await setCondition(cid, targetId, name, removeCondition);
  if (!label) return;
  console.log(`[condition] ${label} loses ${name}`);
  const msg = { text: `${label} is no longer ${name}.`, senderName: 'System', timestamp: Date.now() };
  void postChat(cid, msg, [targetId]);
}

/**
 * Sanctuary — gate checked directly before an attack roll happens (mirrors canMove), not through
 * the normal Hook trigger chain: RAW cancels the attack outright on a failed save, which has to
 * be decided before the d20 is rolled. No ward on targetId = true (attack proceeds normally).
 */
export async function checkSanctuary(cid: string, attackerId: string, targetId: string, targetName: string): Promise<boolean> {
  const engine = getStateEngine(cid);
  const ward = engine.getHooksOwnedBy(targetId, 'sanctuaryWard')[0] as SanctuaryWardHook | undefined;
  if (!ward) return true;
  const { saved, roll, bonus, total, breakdown } = await rollSavingThrow(cid, attackerId, 'wis', ward.dc);
  const attackerName = fightOf(cid, attackerId)?.findParticipant(attackerId)?.name ?? attackerId;
  emitCombatRoll(cid, attackerId, { actorName: attackerName, label: `WIS save to attack ${targetName} through Sanctuary`, dc: ward.dc, success: saved, breakdown });
  logDebug(`[sanctuary] attack on ${targetName} — attacker save vs DC${ward.dc}: d20=${roll}+${bonus}=${total} — ${saved ? 'SAVE, attack proceeds' : 'FAIL, attack blocked'}`);
  return saved;
}

/**
 * Sanctuary "ends if the warded creature makes an attack roll, casts a spell, or deals damage" —
 * called once at the top of the warded creature's own attack/spell-cast, after resource spend
 * succeeds (a blocked action shouldn't cost the ward) but before anything resolves. No ward on
 * actorId = no-op, same as checkSanctuary's "nothing registered" shape.
 */
export async function breakSanctuaryOn(cid: string, actorId: string): Promise<void> {
  const engine = getStateEngine(cid);
  const ward = engine.getHooksOwnedBy(actorId, 'sanctuaryWard')[0];
  if (!ward) return;
  engine.unregister(ward.id);
  const label = fightOf(cid, actorId)?.findParticipant(actorId)?.name ?? actorId;
  console.log(`[sanctuary] ${label}'s Sanctuary ends — they acted`);
  const msg = { text: `${label}'s Sanctuary ends.`, senderName: 'System', timestamp: Date.now() };
  void postChat(cid, msg, [actorId]);
}

