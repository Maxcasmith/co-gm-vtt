import type { Character, ActiveCondition } from 'shared';
import { statMod, calcAC, effectiveWeaponProfs, findPath, isWeapon, isMonkWeapon, closedDoorCells, unarmedStrikeFor, monkMartialArtsActive, monkLevel, martialArtsDie } from 'shared';
import { getCharacter, appendChatLog, listCharacters, getHouseRules } from '../../storage.ts';
import { Participant } from '../../domain/encounter.ts';
import { io, ROOM, combatState, encounters, tokenPositions, dungeons, getStateEngine } from '../../state.ts';
import { D20Roll, rollDice, fmtMod, resolveHit, maxDiceValue } from '../dice.ts';
import { rollModeFor, attackModeAgainstTarget, combineModes } from '../conditions/rollModeFor.ts';
import { offerReaction } from '../stateEngine/reactionPrompt.ts';
import { tokenKey } from '../ai/planEvaluator.ts';
import { offerLuckDisadvantage, runEnemyAI } from './ai.ts';
import { applyDamageToCreature, applyDamageToPlayer, bladeWardPenalty } from './damage.ts';
import { advanceTurn } from './lifecycle.ts';
import { delay, emitResources } from './shared.ts';
import { conditionsHolder } from './statusEffects.ts';
import { checkTrapAt } from './traps.ts';

function isOccupied(positions: Record<string, { gx: number; gy: number }>, gx: number, gy: number, excludeId: string): boolean {
  return Object.entries(positions).some(([id, p]) => id !== excludeId && p.gx === gx && p.gy === gy);
}

/**
 * Walks `actor` up to `maxFt` toward (or, mirrored away from, for 'retreat') `targetPos`, one
 * cell at a time — wall-aware pathing when a dungeon grid is loaded, greedy step-toward otherwise.
 * 'approach' stops early once within `stopAtRangeFt`. Shared by runEnemyAI and the player tactics
 * engine (combat/tactics/), so keyed by `tokenKey(actor)` rather than `actor.id` — creatures and
 * players use different tokenPositions keys (see tokenKey's own doc). Returns wherever the walk
 * actually ended, which may be short of `maxFt`/`targetPos` (blocked path, a trap sprung
 * Restrained mid-walk, or combat ending mid-stride).
 */
export async function walkParticipant(
  cid: string, actor: Participant, fromPos: { gx: number; gy: number }, intent: 'approach' | 'retreat',
  targetPos: { gx: number; gy: number }, maxFt: number, stopAtRangeFt: number, conditions: ActiveCondition[] | undefined,
): Promise<{ gx: number; gy: number }> {
  let { gx, gy } = fromPos;
  const maxSteps = Math.floor(maxFt / 5);
  if (maxSteps <= 0) return { gx, gy };
  const key = tokenKey(actor);

  const destination = intent === 'retreat'
    ? { gx: gx + Math.sign(gx - targetPos.gx) * maxSteps, gy: gy + Math.sign(gy - targetPos.gy) * maxSteps }
    : targetPos;

  const dungeon = dungeons.get(cid);
  const cells = dungeon?.cells;
  const doorBlocked = dungeon ? closedDoorCells(dungeon, { forMovement: true }) : undefined;
  const startPositions = tokenPositions.get(cid) ?? {};
  const occupied = new Set(
    Object.entries(startPositions).filter(([k]) => k !== key).map(([, p]) => `${p.gx},${p.gy}`),
  );
  // If every detour is also blocked by other combatants, fall back to the wall-only route so
  // the actor still makes partial progress and stops at the first occupied cell (below), rather
  // than not moving at all — same graceful degradation as the pre-occupancy-aware behavior. A
  // shut door blocks either route the same as a wall.
  const path = cells
    ? (findPath(cells, gx, gy, destination.gx, destination.gy, occupied, doorBlocked) ??
      findPath(cells, gx, gy, destination.gx, destination.gy, undefined, doorBlocked))
    : null;

  for (let step = 0; step < maxSteps; step++) {
    if (intent === 'approach') {
      const distFt = Math.max(Math.abs(targetPos.gx - gx), Math.abs(targetPos.gy - gy)) * 5;
      if (distFt <= stopAtRangeFt) break;
    }

    const pos = tokenPositions.get(cid) ?? {};
    let next: { gx: number; gy: number } | undefined;
    if (cells) {
      next = path?.[step];
      if (!next || isOccupied(pos, next.gx, next.gy, key)) break;
    } else {
      const dx = Math.sign(destination.gx - gx);
      const dy = Math.sign(destination.gy - gy);
      const candidates = [
        { gx: gx + dx, gy: gy + dy },
        { gx: gx + dx, gy },
        { gx,          gy: gy + dy },
      ].filter(c => c.gx >= 0 && c.gy >= 0 && !isOccupied(pos, c.gx, c.gy, key));
      next = candidates[0];
      if (!next) break;
    }

    gx = next.gx;
    gy = next.gy;

    await delay(220);
    if (!combatState.get(cid)) break;

    const updatedPos = tokenPositions.get(cid) ?? {};
    updatedPos[key] = { gx, gy };
    tokenPositions.set(cid, updatedPos);
    io.to(ROOM).emit('token:moved', { tokenId: key, gx, gy });
    await checkTrapAt(cid, gx, gy, key, actor.name, actor.isPlayer);
    if (!combatState.get(cid)) break;
    // maxSteps was fixed before this loop started off the pre-move speed — a trap sprung
    // mid-walk (Snare) needs its own check here, or a restrained actor just keeps stepping
    // for the rest of its already-decided move.
    if (conditions?.some(c => c.name === 'Restrained')) break;
  }

  return { gx, gy };
}

/**
 * Server-side movement authority — previously absent entirely (see the ponytail note on
 * Participant's action-economy fields: the client owns movementRemaining, nothing server-side
 * enforced it). Restrained's "speed 0" is the first thing that actually needs blocking. Resolves
 * tokenId either as a live participant id (enemies/allies) or, for players, the character name
 * token-position convention uses (see checkTrapAt for the same dual-path lookup).
 */
export async function canMove(cid: string, tokenId: string): Promise<boolean> {
  let holder = await conditionsHolder(cid, tokenId);
  if (!holder) {
    const char = (await listCharacters(cid)).find(c => c.name === tokenId);
    if (char) holder = await conditionsHolder(cid, char.id);
  }
  return !holder?.conditions?.some(c => c.name === 'Restrained');
}

// ── Movement triggers & Opportunity Attacks ─────────────────────────────────

const DEFAULT_REACH_FT = 5;

/** Chebyshev distance in feet between two grid cells — same convention as every other range check in this codebase. */
function cellDistFt(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) * 5;
}

/**
 * The movement counterpart to advanceTurn's beforeTurn/afterTurn firing — called once from
 * token:move whenever a tracked participant's token actually lands somewhere new. Drives two
 * independent things: spell-registered `onMove` hooks (Booming Blade) via the normal
 * StateEngine.trigger(), and the innate Opportunity Attack check, which isn't hook-registered at
 * all since every creature with a reaction has it, not just ones a spell touched.
 */
export async function checkMovementTriggers(
  cid: string, moverId: string, fromGx: number, fromGy: number, toGx: number, toGy: number,
): Promise<void> {
  const encounter = encounters.get(cid);
  const mover = encounter?.findParticipant(moverId);
  if (!mover) return;
  const distanceFt = cellDistFt(fromGx, fromGy, toGx, toGy);
  if (distanceFt === 0) return;

  await getStateEngine(cid).trigger('onMove', {
    participantId: moverId, participantName: mover.name, fromGx, fromGy, toGx, toGy, distanceFt,
  });

  if (combatState.get(cid)) await checkOpportunityAttacks(cid, mover, fromGx, fromGy, toGx, toGy);
}

/** Conditions that already strip reactions outright per RAW — the first place any of these four actually block one, rather than just being a narrated marker. */
const REACTION_LOCKING_CONDITIONS = new Set(['Incapacitated', 'Stunned', 'Paralyzed', 'Unconscious']);

/**
 * 2024 PHB: "You can make an Opportunity Attack when a creature that you can see leaves your
 * reach. To make the Opportunity Attack, you use your Reaction to make one melee attack against
 * the provoking creature." Checked against every hostile participant for the mover's team,
 * reach being that participant's equipped/first melee weapon's range (5ft default, 10ft for a
 * reach weapon). A player reactor is offered the choice (same reaction-prompt flow as Shield);
 * an NPC reactor auto-resolves, matching how enemy actions already auto-resolve with no
 * human decision layer behind them.
 *
 * Skipped for a mover who Disengaged this turn (Participant.disengaging) and for a reactor with
 * no reaction available, a reactionLock (Shocking Grasp), or one of the conditions that already
 * strip reactions outright (REACTION_LOCKING_CONDITIONS).
 *
 * ponytail: only checks the two endpoints, not the path between them — a mover who steps into
 * and back out of the same reach zone within one drag won't provoke, and one who passes through
 * a second reach zone mid-move without ending outside it won't either. Real path-stepping would
 * need the client to send intermediate cells (it only ever sends the final destination); upgrade
 * if "walk past two attackers in one drag" turns out to matter more than "walk straight away
 * from one." Also doesn't check line of sight/obscurement (Fog Cloud) — that check lives in
 * combat.ts, not here, and reach is close enough that it rarely matters.
 */
async function checkOpportunityAttacks(
  cid: string, mover: Participant, fromGx: number, fromGy: number, toGx: number, toGy: number,
): Promise<void> {
  if (mover.disengaging || mover.isDead()) return;
  if ((await getHouseRules(cid)).noAttacksOfOpportunity) return;
  const encounter = encounters.get(cid);
  if (!encounter) return;
  const reactors = mover.teamId === 'players' ? encounter.enemies : encounter.players;
  const positions = tokenPositions.get(cid) ?? {};

  for (const reactor of reactors) {
    if (reactor.isDead() || !reactor.hasResource('reaction')) continue;
    const engine = getStateEngine(cid);
    if (engine.hasHookOwnedBy(reactor.id, 'reactionLock') || engine.hasHookOwnedBy(reactor.id, 'opportunityAttackLock')) continue;
    const holder = await conditionsHolder(cid, reactor.id);
    if (holder?.conditions?.some(c => REACTION_LOCKING_CONDITIONS.has(c.name))) continue;

    const reactorPos = positions[reactor.id] ?? positions[reactor.name];
    if (!reactorPos) continue;

    const reach = await reactorReachFt(cid, reactor);
    const wasInReach = cellDistFt(reactorPos.gx, reactorPos.gy, fromGx, fromGy) <= reach;
    const stillInReach = cellDistFt(reactorPos.gx, reactorPos.gy, toGx, toGy) <= reach;
    if (!wasInReach || stillInReach) continue;

    if (reactor.isPlayer) {
      const picked = await offerReaction(cid, reactor.id, [{
        spellName: 'Attack of Opportunity', attackerName: reactor.name, sourceName: mover.name, kind: 'opportunity',
      }]);
      if (!picked || !combatState.get(cid) || !reactor.hasResource('reaction')) continue;
    }

    reactor.trySpend('reaction');
    emitResources(reactor);
    await resolveOpportunityAttack(cid, reactor, mover);
  }
}

/** Players: their equipped weapon's reach if it's a reach weapon (10ft), else the unarmed-strike default. Creatures: EnemyStatBlock.attacks carries no range/type data at all, so every creature is treated as 5ft reach regardless of what its attacks actually are — a real simplification, upgrade if a ranged-only creature ever needs to NOT get one. */
async function reactorReachFt(cid: string, reactor: Participant): Promise<number> {
  if (!reactor.isPlayer) return DEFAULT_REACH_FT;
  const char = await getCharacter(cid, reactor.id);
  const mainHandId = char?.equipment?.mainHand;
  const item = mainHandId ? char?.inventory?.find(i => i.id === mainHandId) : undefined;
  return item && isWeapon(item) && item.range === 10 ? 10 : DEFAULT_REACH_FT;
}

/**
 * The actual weapon swing an Opportunity Attack resolves into — one melee attack, no ammo spend,
 * no Savage Attacker reroll, no bundled smite (none of those apply to a reflexive reaction swing).
 * Broadcasts the same `combat:attack:result` shape a normal weapon attack does, so it renders
 * identically (hit flash, floating damage) with no client changes needed.
 */
async function resolveOpportunityAttack(cid: string, reactor: Participant, target: Participant): Promise<void> {
  const engine = getStateEngine(cid);
  const encounter = encounters.get(cid);
  if (!encounter) return;

  let weaponName = 'Unarmed Strike';
  let damageFormula = '1';
  let damageType: string | undefined = 'Bludgeoning';
  let attackBonus = 0;
  let statBonus = 0;
  let statName = 'Strength';
  let reactorChar: Character | undefined;

  if (reactor.isPlayer) {
    const char = await getCharacter(cid, reactor.id);
    if (!char) return;
    reactorChar = char;
    const mainHandId = char.equipment?.mainHand;
    const item = mainHandId ? char.inventory?.find(i => i.id === mainHandId) : undefined;
    const weapon = item && isWeapon(item) ? item : undefined;
    const effectiveWeapon = weapon ?? unarmedStrikeFor(char);
    const strMod = statMod(char.stats.str);
    const dexMod = statMod(char.stats.dex);
    const isMeleeReach = !weapon || weapon.range <= 10;
    const monkActive = monkMartialArtsActive(char);
    const useDex = isMeleeReach && (effectiveWeapon.isFinesse || (monkActive && isMonkWeapon(effectiveWeapon))) && dexMod > strMod;
    statBonus = useDex ? dexMod : strMod;
    statName = useDex ? 'Dexterity' : 'Strength';
    const charProf = char.proficiencyBonus ?? 2;
    const classWeaponProfs = effectiveWeaponProfs(char);
    const isProficient = !weapon || weapon.properties?.some(p => classWeaponProfs.includes(p as 'simple' | 'martial'));
    const weaponBonus = (weapon?.attackBonus ?? 0) + (isProficient ? charProf : 0);
    attackBonus = statBonus + weaponBonus;
    weaponName = effectiveWeapon.name;
    damageFormula = monkActive && isMonkWeapon(effectiveWeapon) ? martialArtsDie(monkLevel(char)) : effectiveWeapon.damage;
    damageType = effectiveWeapon.damageType;
  } else if (reactor.creature) {
    const atk = reactor.creature.attacks[0];
    if (!atk) return;
    weaponName = atk.name;
    damageFormula = atk.damage;
    damageType = undefined;
    attackBonus = atk.bonus;
    statBonus = atk.bonus;
    statName = 'Attack';
  } else {
    return;
  }

  let targetAc: number;
  let targetChar: Character | undefined;
  if (target.isPlayer) {
    targetChar = (await listCharacters(cid)).find(c => c.id === target.id || c.name === target.name);
    targetAc = targetChar ? calcAC(targetChar) : 10;
  } else {
    targetAc = target.creature?.ac ?? 10;
  }
  const targetKeyId = target.isPlayer ? (targetChar?.id ?? target.id) : target.id;

  // Lucky — offered pre-roll same as runEnemyAI's attack path; opportunity attacks are a
  // separate resolution function so they need their own offer, not shared plumbing.
  const luckDisadvantage = target.isPlayer && await offerLuckDisadvantage(cid, targetKeyId, target.name, reactor.name);
  if (!combatState.get(cid)) return;
  const mode = combineModes(
    rollModeFor(reactorChar ?? reactor.creature ?? {}, 'attack'),
    attackModeAgainstTarget(targetChar ?? target.creature ?? {}),
    luckDisadvantage ? -1 : 0,
  );
  const roll = new D20Roll({ withDisadvantage: mode < 0, withAdvantage: mode > 0 }).roll();
  attackBonus += bladeWardPenalty(cid, targetKeyId);
  const atkCtx = await engine.trigger('afterAttackRoll', await engine.trigger('beforeAttackRoll', {
    attackerId: reactor.id, attackerName: reactor.name,
    targetId: targetKeyId, targetName: target.name, targetIsPlayer: target.isPlayer,
    sourceName: weaponName, d20: roll, attackBonus, ac: targetAc,
    total: roll + attackBonus, hit: resolveHit(roll, attackBonus, targetAc),
  }));
  if (!combatState.get(cid)) return;
  atkCtx.total = atkCtx.d20 + atkCtx.attackBonus;
  atkCtx.hit = resolveHit(atkCtx.d20, atkCtx.attackBonus, atkCtx.ac);
  const isCrit = atkCtx.d20 === 20;
  const houseRules = await getHouseRules(cid);

  let damage: number | undefined;
  let damageRoll: number | undefined;
  let remainingHp: number | undefined;
  let targetDead = false;
  const damageStatBonus = reactor.isPlayer ? statBonus : undefined;
  if (atkCtx.hit) {
    damageRoll = isCrit
      ? rollDice(damageFormula) + (houseRules.perkinsCrit ? maxDiceValue(damageFormula) : rollDice(damageFormula))
      : rollDice(damageFormula);
    const dmgCtx = await engine.trigger('beforeDamage', {
      sourceId: reactor.id, targetId: targetKeyId, targetName: target.name,
      amount: damageRoll + (damageStatBonus ?? 0),
      damageType, sourceName: weaponName,
    });
    damage = Math.max(0, dmgCtx.amount);
    if (target.isPlayer && targetChar) {
      await applyDamageToPlayer(cid, target, damage, { charId: targetChar.id, sourceId: reactor.id, isCrit });
      remainingHp = target.currentHp;
      targetDead = target.currentHp <= 0;
    } else {
      await applyDamageToCreature(cid, target.id, damage, { sourceId: reactor.id, isCrit });
      remainingHp = encounter.findCreature(target.id)?.currentHp;
      targetDead = encounter.findCreature(target.id)?.isDead() ?? false;
    }
    await engine.trigger('afterDamage', dmgCtx);
  }

  console.log(`[aoo] ${reactor.name} makes an Opportunity Attack on ${target.name}: ${roll}${fmtMod(attackBonus)}=${atkCtx.total} vs AC ${targetAc} — ${atkCtx.hit ? `HIT ${damage}` : 'MISS'}`);
  io.to(ROOM).emit('combat:attack:result', {
    attackerName: reactor.name, targetName: target.name, targetId: targetKeyId,
    weaponName, isMelee: true, d20: roll, attackBonus, statBonus, statName, weaponBonus: attackBonus - statBonus,
    total: atkCtx.total, ac: targetAc, hit: atkCtx.hit, isCrit, damage, damageRoll, damageFormula: atkCtx.hit ? damageFormula : undefined,
    damageStatBonus, remainingHp, targetDead,
  });
  const msg = { text: `${reactor.name} makes an Opportunity Attack on ${target.name}${atkCtx.hit ? ` — hit for ${damage}!` : ' — misses.'}`, senderName: 'System', timestamp: Date.now() };
  void appendChatLog(cid, msg);
  io.to(ROOM).emit('chat:message', msg);
}

/**
 * Sets targetId's height off the ground. Dropping it 10ft or more (climbing/being lifted down
 * doesn't call this at all — only an actual fall does) rolls 1d6 Bludgeoning per 10ft fallen,
 * capped at 20d6 (RAW), no save, routed through the normal beforeDamage/afterDamage chain so any
 * hook gets a say — specifically DamageResistanceHook keyed to `spellName: 'Falling'`, which is
 * exactly the shape Feather Fall registers (same mechanism Shield already uses against Magic
 * Missile, reused rather than building a fall-specific negation path).
 */
export async function applyElevationChange(cid: string, targetId: string, elevationFt: number): Promise<void> {
  const encounter = encounters.get(cid);
  const participant = encounter?.findParticipant(targetId);
  if (!participant) return;

  const clamped = Math.max(0, elevationFt);
  const fellFt = participant.elevationFt - clamped;
  participant.elevationFt = clamped;
  io.to(ROOM).emit('combat:elevation:update', { targetId, elevationFt: clamped });
  if (fellFt < 10) return;

  // Flying is a controlled descent, not a fall — no damage regardless of how far it drops.
  const holder = await conditionsHolder(cid, targetId);
  if (holder?.conditions?.some(c => c.name === 'Flying')) return;

  const dice = Math.min(20, Math.floor(fellFt / 10));
  const engine = getStateEngine(cid);
  const dmgCtx = await engine.trigger('beforeDamage', {
    sourceId: targetId, targetId, targetName: participant.name,
    amount: rollDice(`${dice}d6`), damageType: 'Bludgeoning', sourceName: 'Falling',
  });
  const damage = Math.max(0, dmgCtx.amount);
  if (damage > 0) {
    if (participant.isPlayer) await applyDamageToPlayer(cid, participant, damage, { sourceId: targetId });
    else await applyDamageToCreature(cid, targetId, damage);
  }
  await engine.trigger('afterDamage', dmgCtx);
  console.log(`[elevation] ${participant.name} falls ${fellFt}ft — ${damage} damage`);
}

