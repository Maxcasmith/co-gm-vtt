import type { ActionResource, Character, Directive, Group, Manoeuvre, TargetRef } from 'shared';
import { actionCostFromCastingTime, isConsumable } from 'shared';
import type { Participant } from '../../domain/encounter.ts';
import type { TacticalContext } from '../ai/types.ts';
import { evaluateCondition, nearestEnemy, resolveTarget, type TurnState } from './conditionEvaluator.ts';
import { scoreDirective } from './scorer.ts';
import { walkParticipant } from '../runtime/movement.ts';
import { weaponFor } from '../runtime/ai.ts';
import { resolvePlayerAttack, resolvePlayerSpellAttack } from '../../socketHandlers/combat.ts';
import { resolvePlayerItemUse } from '../../socketHandlers/inventory.ts';
import { findSpell } from '../../routes/spells.ts';
import { fightOf } from '../../state.ts';
import { distanceFt, posOf, tokenKey } from '../ai/planEvaluator.ts';

const SAFETY_MAX_ITERATIONS = 20;

type Resource = 'movement' | ActionResource;

interface Candidate {
  manoeuvreId: string;
  directive: Directive;
  resource: Resource;
  /** The nearest "target" directive in scope resolved to a live participant, falling back to the manoeuvre's fixed `defaultTarget` if none is in scope — what this directive actually acts on. */
  target: Participant | undefined;
  /** The ref behind `target` when it came from an in-scope "target" directive (undefined if `target` is just the manoeuvre default) — "move" uses this to know whether it has a local override to re-resolve after moving changes positions. */
  targetRef: TargetRef | undefined;
}

/**
 * Move spends movement; Dash/Disengage/Dodge are always the action (PHB); a weapon swing is
 * always an action too; a spell's real cost depends on the spell (matches
 * resolvePlayerSpellAttack's own `actionCostOverride ?? actionCostFromCastingTime` classification,
 * so a bonus-action spell here is never mistaken for competing with an action-cost attack); a
 * consumable's cost is whatever that item declares (`Consumable.actionCost`). A "reaction" spell
 * never becomes eligible below (nothing tracks a reaction resource on the actor's own turn), but
 * is still classified correctly for the AI tab's conflict warning.
 */
function directiveResource(directive: Directive, character: Character): Resource {
  if (directive.kind === 'move') return 'movement';
  if (directive.kind === 'attackWithWeapon' || directive.kind === 'dash' || directive.kind === 'disengage' || directive.kind === 'dodge') return 'action';
  if (directive.kind === 'target') return 'action'; // unreachable — walkGroup never pushes a "target" directive as a candidate
  if (directive.kind === 'useConsumable') {
    const item = character.inventory?.find(i => i.id === directive.itemId);
    return item && isConsumable(item) ? item.actionCost : 'action';
  }
  const spell = directive.spellName ? findSpell(directive.spellName) : undefined;
  return spell ? (spell.combat?.actionCostOverride ?? actionCostFromCastingTime(spell.castingTime) ?? 'action') : 'action';
}

/**
 * Walks one Group's children left to right, threading `gate` — the running when/or-when
 * accumulator — and pushes every Directive whose enclosing gate currently holds into `out`.
 * `isFirst` is this group's own position in its parent's children list: the first group ANDs its
 * own condition into the incoming gate ("when"), every later sibling ORs it in ("or when") — see
 * shared/types/tactics.ts's Group doc. Returns this group's own final gate so a caller processing
 * a sibling list can chain off it.
 *
 * `inheritedTargetRef` is the nearest "target" directive found so far — this group's own
 * preceding siblings take priority (a "target" child updates it for everything after, within this
 * list), falling back to whatever was already found in an ancestor's list otherwise. A nested
 * group's own scan never leaks back out to its parent's later siblings — only what the parent
 * passed *in* plus what it itself updates going forward. The group's own "when"/"or when"
 * condition resolves "target" against `inheritedTargetRef` too (what was in scope *before*
 * this group), not just `defaultTarget` — a Group's gate is one more consumer of the same target
 * system Move already used, not a separate hardcoded default.
 */
function walkGroup(
  group: Group, incomingGate: boolean, isFirst: boolean, character: Character, defaultTarget: Participant | undefined,
  ctx: TacticalContext, turnState: TurnState, manoeuvreId: string, out: Candidate[],
  inheritedTargetRef: TargetRef | undefined,
): boolean {
  const scopedTarget = inheritedTargetRef ? (resolveTarget(inheritedTargetRef, ctx) ?? defaultTarget) : defaultTarget;
  const rawHolds = evaluateCondition(group.condition, character, scopedTarget, ctx, turnState);
  const ownHolds = group.negate ? !rawHolds : rawHolds;
  let gate = isFirst ? (incomingGate && ownHolds) : (incomingGate || ownHolds);

  let nearestTargetRef = inheritedTargetRef;
  group.children.forEach((child, i) => {
    if (child.type === 'group') {
      gate = walkGroup(child, gate, i === 0, character, defaultTarget, ctx, turnState, manoeuvreId, out, nearestTargetRef);
    } else if (child.kind === 'target') {
      nearestTargetRef = child.target;
    } else if (gate) {
      const directiveTarget = nearestTargetRef ? (resolveTarget(nearestTargetRef, ctx) ?? defaultTarget) : defaultTarget;
      out.push({ manoeuvreId, directive: child, resource: directiveResource(child, character), target: directiveTarget, targetRef: nearestTargetRef });
    }
  });
  return gate;
}

/**
 * Runs one directive's action/bonus-action slot; returns whether it hit (undefined for a
 * non-roll outcome, which never sets lastActionMissed). `target` is optional — only
 * attackWithWeapon/castSpell need one; Disengage/Dodge act on the actor itself and Use Consumable
 * doesn't need a participant target at all.
 */
async function executeDirective(
  cid: string, actor: Participant, character: Character, directive: Directive, target: Participant | undefined,
): Promise<boolean | undefined> {
  if (directive.kind === 'attackWithWeapon') {
    if (!target) return undefined;
    const result = await resolvePlayerAttack(cid, {
      attackerId: actor.id, attackerName: actor.name, targetId: target.id, weapon: weaponFor(character),
    });
    return result?.hit;
  }
  if (directive.kind === 'castSpell') {
    if (!target) return undefined;
    const spell = directive.spellName ? findSpell(directive.spellName) : undefined;
    if (!spell) return undefined;
    const result = await resolvePlayerSpellAttack(cid, {
      casterId: actor.id, casterName: actor.name, targetIds: [target.id], spell, slotLevel: spell.level,
    });
    return result?.hit;
  }
  if (directive.kind === 'disengage') {
    // Real hook: blocks Opportunity Attacks against the actor for the rest of this turn (checkOpportunityAttacks in runtime.ts), cleared automatically at their next refillResources.
    actor.disengaging = true;
    return undefined;
  }
  if (directive.kind === 'useConsumable') {
    if (!directive.itemId) return undefined;
    await resolvePlayerItemUse(cid, { characterId: actor.id, characterName: actor.name, itemId: directive.itemId });
    return undefined;
  }
  // 'dodge' — no mechanical effect exists anywhere in this engine yet, for AI or human play (see
  // CombatDock's Dodge button); spends the action and stops there rather than faking a real one.
  return undefined;
}

/**
 * Plays out an aiControlled character's turn. Every manoeuvre's tree is walked fresh each
 * decision point (a Directive is eligible whenever its enclosing when/and/or gate currently holds
 * and its resource is still free) — every eligible directive across every manoeuvre competes on
 * score (combat/tactics/scorer.ts), the winner executes and its resource is spent, then the whole
 * thing repeats, so the plan can pivot mid-turn as the situation changes (a miss, a kill, having
 * moved) without being locked into whichever manoeuvre "started."
 */
export async function runManoeuvres(cid: string, actor: Participant, character: Character, ctx: TacticalContext): Promise<void> {
  // Drops any pre-tree manoeuvre saved before `root` existed — stale shape, not real player data.
  // `defaultTarget` is newer still and additive, so it's defaulted rather than treated as another reason to drop.
  const manoeuvres: Manoeuvre[] = (character.tactics ?? [])
    .filter(m => m.root?.type === 'group')
    .map(m => ({ ...m, defaultTarget: (m.defaultTarget && typeof m.defaultTarget === 'object') ? m.defaultTarget : { strategy: 'closestEnemy' as const } }));
  const turnState: TurnState = { lastActionMissed: false };

  let movementFt = character.conditions?.some(c => c.name === 'Restrained') ? 0 : (character.speed ?? 30);
  let actionAvailable = true;
  let bonusActionAvailable = true;

  for (let i = 0; i < SAFETY_MAX_ITERATIONS; i++) {
    if (!fightOf(cid, actor.id)) return;
    if (!actionAvailable && !bonusActionAvailable && movementFt <= 0) return;

    const candidates: Candidate[] = [];
    for (const manoeuvre of manoeuvres) {
      const manoeuvreTarget = resolveTarget(manoeuvre.defaultTarget, ctx) ?? nearestEnemy(ctx);
      walkGroup(manoeuvre.root, true, true, character, manoeuvreTarget, ctx, turnState, manoeuvre.id, candidates, undefined);
    }
    const eligible = candidates.filter(c =>
      (c.resource === 'movement' && movementFt > 0) ||
      (c.resource === 'action' && actionAvailable) ||
      (c.resource === 'bonusAction' && bonusActionAvailable),
    );
    if (!eligible.length) return;

    const scored = eligible.map(c => ({ ...c, score: scoreDirective(c.directive, character) }));
    scored.sort((a, b) => b.score - a.score);
    const chosen = scored[0]!;

    if (chosen.directive.kind === 'move') {
      const moveTarget = (chosen.targetRef ? resolveTarget(chosen.targetRef, ctx) : undefined) ?? chosen.target;
      const intent = chosen.directive.direction === 'away' ? 'retreat' : 'approach';
      if (moveTarget) {
        const selfPos = posOf(ctx, ctx.actor);
        const targetPos = posOf(ctx, moveTarget);
        if (selfPos && targetPos) {
          const stopAtRangeFt = intent === 'approach' ? weaponFor(character).range : 0;
          const newPos = await walkParticipant(cid, actor, selfPos, intent, targetPos, movementFt, stopAtRangeFt, character.conditions);
          movementFt = Math.max(0, movementFt - distanceFt(selfPos, newPos));
          ctx.positions[tokenKey(actor)] = newPos;
        }
      } else {
        movementFt = 0;
      }
      continue;
    }
    if (chosen.directive.kind === 'dash') {
      // No server-side hook exists for human Dash either (client-only `vtt:movement:gained`, see
      // CombatDock) — the AI turn is server-authoritative already, so this just grants it directly.
      movementFt += character.speed ?? 30;
      actionAvailable = false;
      continue;
    }
    if (!fightOf(cid, actor.id)) return;

    const hit = await executeDirective(cid, actor, character, chosen.directive, chosen.target);
    if (hit !== undefined) turnState.lastActionMissed = !hit;
    if (chosen.resource === 'action') actionAvailable = false;
    else if (chosen.resource === 'bonusAction') bonusActionAvailable = false;
  }
}
