import { randomUUID } from 'crypto';
import type { EnemyAction, EnemyStatBlock } from 'shared';
import type { Creature } from '../../domain/creature.ts';
import type { Participant } from '../../domain/encounter.ts';
import { io, ROOM, encounters, tokenPositions, getStateEngine } from '../../state.ts';
import { appendChatLog } from '../../storage.ts';
import { rollDice } from '../dice.ts';
import { applyDamageToCreature, applyDamageToPlayer, applyHealingToCreature, applyHealingToPlayer, rollSavingThrow, addToTurnOrder } from '../runtime.ts';
import { RollModifierHook } from '../stateEngine/hooks/RollModifierHook.ts';
import { AcModifierHook } from '../stateEngine/hooks/AcModifierHook.ts';
import { RoundExpiryHook } from '../stateEngine/hooks/ExpiryHook.ts';

/**
 * Runs whatever a plan's actions[]-sourced action does — the counterpart to runEnemyAI's existing
 * attacks[] resolution (kept where it is, in runtime.ts, since it's already fully wired into the
 * reaction/Sanctuary/blade-ward machinery a plain weapon swing needs). These five kinds are new
 * behavior with no equivalent to reuse, so they land here instead of growing runEnemyAI further.
 */
export async function executeSpecialAction(cid: string, actor: Participant, action: EnemyAction, target: Participant, round: number): Promise<void> {
  switch (action.kind) {
    case 'aoe': return executeAoe(cid, actor, action, target);
    case 'heal': return executeHeal(cid, actor, action, target);
    case 'buff': return executeModifier(cid, actor, action, target, round);
    case 'debuff': return executeModifier(cid, actor, action, target, round);
    case 'summon': return executeSummon(cid, actor, action);
  }
}

async function dealDamage(cid: string, sourceId: string, sourceName: string, target: Participant, amount: number): Promise<void> {
  const engine = getStateEngine(cid);
  const dmgCtx = await engine.trigger('beforeDamage', {
    sourceId, targetId: target.id, targetName: target.name, amount, damageType: undefined, sourceName,
  });
  const damage = Math.max(0, dmgCtx.amount);
  if (target.isPlayer) await applyDamageToPlayer(cid, target, damage, { sourceId });
  else await applyDamageToCreature(cid, target.id, damage, { sourceId });
  await engine.trigger('afterDamage', dmgCtx);
}

function announce(cid: string, text: string): void {
  const msg = { text, senderName: 'Combat', timestamp: Date.now() };
  io.to(ROOM).emit('chat:message', msg);
  void appendChatLog(cid, msg);
}

async function executeAoe(cid: string, actor: Participant, action: Extract<EnemyAction, { kind: 'aoe' }>, target: Participant): Promise<void> {
  const encounter = encounters.get(cid);
  if (!encounter) return;
  const positions = tokenPositions.get(cid) ?? {};
  const centerKey = target.isPlayer ? target.name : target.id;
  const center = positions[centerKey];
  if (!center) return;

  const affected = encounter.turnOrder.filter(p => p.teamId !== actor.teamId && !p.isDown());
  for (const p of affected) {
    const key = p.isPlayer ? p.name : p.id;
    const pos = positions[key];
    if (!pos) continue;
    if (Math.max(Math.abs(pos.gx - center.gx), Math.abs(pos.gy - center.gy)) * 5 > action.radius) continue;

    let damage = rollDice(action.damage);
    if (action.saveAbility && action.saveDC !== undefined) {
      const { saved } = await rollSavingThrow(cid, p.id, action.saveAbility, action.saveDC);
      if (saved) damage = Math.floor(damage / 2);
    }
    await dealDamage(cid, actor.id, action.name, p, damage);
  }
  announce(cid, `${actor.name} unleashes ${action.name}!`);
}

async function executeHeal(cid: string, actor: Participant, action: Extract<EnemyAction, { kind: 'heal' }>, target: Participant): Promise<void> {
  const amount = rollDice(action.healFormula);
  if (target.isPlayer) applyHealingToPlayer(cid, target, target.id, amount, action.name);
  else applyHealingToCreature(cid, target.id, amount);
  announce(cid, `${actor.name} casts ${action.name} on ${target.name}, restoring ${amount} HP.`);
}

/** Buff and debuff share one execution path — same hook primitives, opposite sign, debuff gated by a save. */
async function executeModifier(cid: string, actor: Participant, action: Extract<EnemyAction, { kind: 'buff' | 'debuff' }>, target: Participant, round: number): Promise<void> {
  if (action.kind === 'debuff' && action.saveAbility && action.saveDC !== undefined) {
    const { saved } = await rollSavingThrow(cid, target.id, action.saveAbility, action.saveDC);
    if (saved) { announce(cid, `${target.name} resists ${action.name}.`); return; }
  }

  const engine = getStateEngine(cid);
  const sign = action.kind === 'buff' ? 1 : -1;
  const die = action.kind === 'buff' ? action.rollBonusDie : action.rollPenaltyDie;
  const ac = action.kind === 'buff' ? action.acBonus : action.acPenalty;
  const hookIds: string[] = [];

  if (die) {
    const h = new RollModifierHook({ ownerId: target.id, source: action.name, dieSize: die, sign, kind: 'rollModifier' });
    engine.register(h);
    hookIds.push(h.id);
  }
  if (ac) {
    const h = new AcModifierHook({ ownerId: target.id, source: action.name, value: sign * Math.abs(ac) });
    engine.register(h);
    hookIds.push(h.id);
  }
  if (hookIds.length) {
    engine.register(new RoundExpiryHook({ ownerId: target.id, source: action.name, targetHookIds: hookIds, expiresOnRound: round + action.durationRounds }));
  }

  announce(cid, action.kind === 'buff'
    ? `${actor.name} bolsters ${target.name} with ${action.name}.`
    : `${actor.name} afflicts ${target.name} with ${action.name}.`);
}

/**
 * ponytail: no per-role stat-block library exists (roles are behavior templates, not authored
 * monster stats — see roleTemplates.ts), and calling the encounter-generation LLM mid-turn would
 * stall a live combat round. A summon is instead a weakened copy of its conjurer: same stats,
 * a third the HP, quarter the CR, its own first attack. Upgrade to real per-role stat templates
 * if a Conjurer ever needs to summon something mechanically distinct from its own kit.
 */
function deriveSummonStatBlock(summoner: Creature, action: Extract<EnemyAction, { kind: 'summon' }>, index: number): EnemyStatBlock {
  return {
    id: randomUUID(),
    name: `${action.name} ${index + 1}`,
    cr: Math.max(0.125, summoner.cr / 4),
    hp: Math.max(1, Math.round(summoner.hp / 3)),
    ac: summoner.ac,
    speed: summoner.speed,
    stats: summoner.stats,
    attacks: summoner.attacks.length ? [summoner.attacks[0]!] : [{ name: 'Slam', bonus: 2, damage: '1d4' }],
    creatureType: summoner.creatureType,
    role: action.templateRole,
  };
}

function findOpenAdjacent(positions: Record<string, { gx: number; gy: number }>, gx: number, gy: number): { gx: number; gy: number } {
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const occupied = new Set(Object.values(positions).map(p => `${p.gx},${p.gy}`));
  for (const [dx, dy] of offsets) {
    const c = { gx: gx + dx!, gy: gy + dy! };
    if (c.gx >= 0 && c.gy >= 0 && !occupied.has(`${c.gx},${c.gy}`)) return c;
  }
  return { gx, gy }; // no open cell — stack on the summoner's own rather than fail the summon outright
}

async function executeSummon(cid: string, actor: Participant, action: Extract<EnemyAction, { kind: 'summon' }>): Promise<void> {
  const encounter = encounters.get(cid);
  const creature = actor.creature;
  if (!encounter || !creature) return;

  const positions = tokenPositions.get(cid) ?? {};
  const selfPos = positions[actor.id];
  const spawned: Participant[] = [];

  for (let i = 0; i < action.count; i++) {
    const participant = encounter.spawnEnemy(deriveSummonStatBlock(creature, action, i));
    spawned.push(participant);
    if (selfPos) {
      const pos = findOpenAdjacent(positions, selfPos.gx, selfPos.gy);
      positions[participant.id] = pos;
      io.to(ROOM).emit('token:moved', { tokenId: participant.id, gx: pos.gx, gy: pos.gy });
    }
  }
  tokenPositions.set(cid, positions);
  addToTurnOrder(cid, spawned);

  io.to(ROOM).emit('encounter:ready', encounter.enemies.filter(p => p.creature).map(p => p.creature!.toStatBlock()));
  announce(cid, `${actor.name} summons ${spawned.map(p => p.name).join(', ')}!`);
}
