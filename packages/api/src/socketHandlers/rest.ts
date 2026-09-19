import { randomUUID } from 'node:crypto';
import { hasOriginFeat, trySpendResource, FAST_CRAFTING_TABLE } from 'shared';
import type { WorldActor, Goal } from 'shared';
import { io, campaignRoom, playerSocketIds, pendingRests, type RestChoice } from '../state.ts';
import { listCharacters, updateCharacter, getConfig, readWorldState, writeWorldState, readCampaignFile, readGoals, writeGoals } from '../storage.ts';
import { getFeatureProvider } from '../providers/index.ts';
import { generateWorldState, tickWorldNarrative } from '../session-processor/imagePrompts.ts';
import { applyEffects } from '../effects.ts';
import { applyLongRest, applyShortRest, restDurationHours } from '../rest.ts';
import { logError } from '../logger.ts';
import type { JoinContext } from './context.ts';

export function registerRestHandlers(ctx: JoinContext): void {
  const { socket } = ctx;

  socket.on('rest:open', () => { io.to(campaignRoom(ctx.campaignId)).emit('rest:open'); });

  socket.on('rest:choice', ({ campaignId, characterId, resting, restType, hitDiceSpent, craftedItem, grantInspiration }) => {
    let votes = pendingRests.get(campaignId);
    if (!votes) { votes = new Map<string, RestChoice>(); pendingRests.set(campaignId, votes); }
    votes.set(characterId, { resting, restType, hitDiceSpent, ...(craftedItem ? { craftedItem } : {}), ...(grantInspiration ? { grantInspiration } : {}) });
    void broadcastRestProgress(campaignId);
    void maybeResolveRest(campaignId);
  });

  // Lets a player retract a vote they haven't been resolved on yet (changed their mind while waiting).
  socket.on('rest:cancel', ({ campaignId, characterId }) => {
    const votes = pendingRests.get(campaignId);
    if (!votes?.delete(characterId)) return;
    void broadcastRestProgress(campaignId);
  });
}

/** Tells clients whether every online party member has currently committed to a vote — used to lock the cancel button once retracting would just get raced by resolution. */
export async function broadcastRestProgress(campaignId: string): Promise<void> {
  const votes = pendingRests.get(campaignId);
  const party = await listCharacters(campaignId);
  const onlineIds = party.filter(c => playerSocketIds.has(c.id)).map(c => c.id);
  const allCommitted = onlineIds.length > 0 && !!votes && onlineIds.every(id => votes.has(id));
  io.to(campaignRoom(campaignId)).emit('rest:progress', { allCommitted });
}

/** Resolves a campaign's pending rest once every currently-online party member has voted. */
export async function maybeResolveRest(campaignId: string): Promise<void> {
  const votes = pendingRests.get(campaignId);
  if (!votes) return;

  const party = await listCharacters(campaignId);
  const onlineIds = party.filter(c => playerSocketIds.has(c.id)).map(c => c.id);
  if (onlineIds.length === 0 || !onlineIds.every(id => votes.has(id))) return;

  pendingRests.delete(campaignId);

  const restingEntries = [...votes.entries()].filter(([, v]) => v.resting);
  const hours = restingEntries.length === 0 ? 0 : Math.max(...restingEntries.map(([id, v]) => {
    const char = party.find(c => c.id === id);
    return char ? restDurationHours(char, v.restType) : 0;
  }));
  const longRestHappened = restingEntries.some(([, v]) => v.restType === 'long');

  let worldEvents: string | undefined;
  if (hours > 0) {
    await applyEffects(campaignId, [{ type: 'clock', secs: hours * 3600 }], 'all');
  }
  if (longRestHappened) {
    worldEvents = await tickWorldForRest(campaignId, hours);
  }

  for (const [charId, choice] of votes) {
    const char = party.find(c => c.id === charId);
    if (!char) continue;

    if (!choice.resting) {
      io.to(campaignRoom(campaignId)).emit('rest:result', { characterId: charId, characterName: char.name, resting: false, restType: choice.restType });
      continue;
    }

    const outcome = choice.restType === 'long' ? applyLongRest(char) : applyShortRest(char, choice.hitDiceSpent);
    await updateCharacter(campaignId, charId, fresh => ({ ...fresh, ...outcome }));

    // Origin feat Crafter: Fast Crafting, Long Rest only — one item from the table, gone at the next one.
    if (choice.restType === 'long' && choice.craftedItem && hasOriginFeat(char, 'Crafter') && (FAST_CRAFTING_TABLE as readonly string[]).includes(choice.craftedItem)) {
      const charWithOutcome = { ...char, resourceUses: outcome.resourceUses };
      const nextResourceUses = trySpendResource(charWithOutcome, 'fastCrafting');
      if (nextResourceUses) {
        const item = {
          id: randomUUID(), type: 'consumable' as const, name: choice.craftedItem,
          description: 'Fast-crafted with Crafter. Vanishes at your next Long Rest.',
          quantity: 1, effect: '', actionCost: 'action' as const, expiresOnLongRest: true,
        };
        await updateCharacter(campaignId, charId, fresh => ({
          ...fresh, resourceUses: nextResourceUses, inventory: [...(fresh.inventory ?? []), item],
        }));
        outcome.resourceUses = nextResourceUses;
        const sid = playerSocketIds.get(charId);
        if (sid) io.to(sid).emit('character:inventory:add', [item]);
      }
    }

    // Origin feat Musician: once per Short or Long Rest, grant Heroic Inspiration to up to
    // Proficiency Bonus other party members. ponytail: no "who's in earshot" targeting — grants
    // to the first N other party members in roster order; upgrade if manual ally-picking matters.
    if (choice.grantInspiration && hasOriginFeat(char, 'Musician')) {
      const charWithOutcome = { ...char, resourceUses: outcome.resourceUses };
      const nextResourceUses = trySpendResource(charWithOutcome, 'musicianPerformance');
      if (nextResourceUses) {
        outcome.resourceUses = nextResourceUses;
        const recipients = party.filter(c => c.id !== charId).slice(0, char.proficiencyBonus ?? 2);
        for (const ally of recipients) {
          await updateCharacter(campaignId, ally.id, fresh => ({ ...fresh, heroicInspiration: true }));
          const sid = playerSocketIds.get(ally.id);
          if (sid) io.to(sid).emit('character:inspiration:update', { heroicInspiration: true });
        }
      }
    }

    io.to(campaignRoom(campaignId)).emit('rest:result', {
      characterId: charId, characterName: char.name, resting: true, restType: choice.restType,
      hpGained: outcome.hpGained, currentHp: outcome.currentHp, maxHp: outcome.maxHp,
      currentSpellSlots1: outcome.currentSpellSlots1, maxSpellSlots1: outcome.maxSpellSlots1,
      resourceUses: outcome.resourceUses,
      worldEvents,
    });
  }
}

/**
 * Pure milestone/day-threshold advancement, no I/O — mutates `actors`/`goals` in place and
 * returns the newly-crossed-milestone/succeeded messages for narration. Split out from
 * tickWorldForRest so this logic is unit-testable without an LLM call — see
 * rest.advanceWorldActorGoals.selfcheck.ts.
 */
export function advanceWorldActorGoals(actors: WorldActor[], goals: Goal[], hours: number): string[] {
  const newlyCompleted: string[] = [];
  for (const actor of actors) {
    if (actor.status !== 'active') continue;
    const goal = goals.find(g => g.id === actor.goalId);
    if (!goal) continue;

    goal.daysElapsed = (goal.daysElapsed ?? 0) + hours / 24;
    for (const ms of goal.milestones) {
      if (!ms.completed && ms.day !== undefined && goal.daysElapsed >= ms.day) {
        ms.completed = true;
        ms.completedOnDay = Math.floor(goal.daysElapsed);
        newlyCompleted.push(`${actor.name}: ${ms.description}`);
      }
    }
    const next = goal.milestones.find(m => !m.completed);
    if (next) {
      actor.currentStatus = `Working toward: ${next.description}`;
    } else if (goal.totalDays !== undefined && goal.daysElapsed >= goal.totalDays) {
      actor.status = 'succeeded';
      goal.status = 'succeeded';
      actor.currentStatus = `Has achieved their ultimate goal: ${goal.description}`;
      newlyCompleted.push(`⚠️ ${actor.name} HAS SUCCEEDED: ${goal.description}`);
    }
  }
  return newlyCompleted;
}

/** Advances the background actor/world-narrative clock (ported from the old long-rest route) and returns the "while you slept" text, if any. */
async function tickWorldForRest(campaignId: string, hours: number): Promise<string | undefined> {
  try {
    let state = await readWorldState(campaignId);
    const config = await getConfig();
    const adapter = getFeatureProvider(config, 'worldStateAdvance');

    if (!state) {
      const [worldMd, factionsMd] = await Promise.all([
        readCampaignFile(campaignId, 'world.md'),
        readCampaignFile(campaignId, 'factions.md'),
      ]);
      state = await generateWorldState(campaignId, worldMd ?? '', factionsMd ?? '', adapter);
      if (state) { state.dayNumber = 1; state.totalHoursElapsed = 0; }
    }
    if (!state) return undefined;

    state.totalHoursElapsed += hours;
    state.dayNumber = Math.floor(state.totalHoursElapsed / 24) + 1;

    const goals = await readGoals(campaignId);
    const newlyCompleted = advanceWorldActorGoals(state.actors, goals, hours);
    await writeGoals(campaignId, goals);

    const worldMd = await readCampaignFile(campaignId, 'world.md');
    const worldEvents = await tickWorldNarrative(state, hours, worldMd ?? '', newlyCompleted, adapter, goals);
    await writeWorldState(campaignId, state);
    return worldEvents ?? undefined;
  } catch (err) {
    logError('socketHandlers/rest:tickWorldForRest', err);
    return undefined;
  }
}
