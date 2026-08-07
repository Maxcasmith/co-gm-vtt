import { io, ROOM, playerSocketIds, pendingRests, type RestChoice } from '../state.ts';
import { listCharacters, updateCharacter, getConfig, readWorldState, writeWorldState, readCampaignFile } from '../storage.ts';
import { getFeatureProvider } from '../providers/index.ts';
import { generateWorldState, tickWorldNarrative } from '../session-processor/imagePrompts.ts';
import { applyEffects } from '../effects.ts';
import { applyLongRest, applyShortRest, restDurationHours } from '../rest.ts';
import { logError } from '../logger.ts';
import type { JoinContext } from './context.ts';

export function registerRestHandlers(ctx: JoinContext): void {
  const { socket } = ctx;

  socket.on('rest:open', () => { io.to(ROOM).emit('rest:open'); });

  socket.on('rest:choice', ({ campaignId, characterId, resting, restType, hitDiceSpent }) => {
    let votes = pendingRests.get(campaignId);
    if (!votes) { votes = new Map<string, RestChoice>(); pendingRests.set(campaignId, votes); }
    votes.set(characterId, { resting, restType, hitDiceSpent });
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
  io.to(ROOM).emit('rest:progress', { allCommitted });
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
    await applyEffects(campaignId, [{ type: 'clock', secs: hours * 3600 }]);
  }
  if (longRestHappened) {
    worldEvents = await tickWorldForRest(campaignId, hours);
  }

  for (const [charId, choice] of votes) {
    const char = party.find(c => c.id === charId);
    if (!char) continue;

    if (!choice.resting) {
      io.to(ROOM).emit('rest:result', { characterId: charId, characterName: char.name, resting: false, restType: choice.restType });
      continue;
    }

    const outcome = choice.restType === 'long' ? applyLongRest(char) : applyShortRest(char, choice.hitDiceSpent);
    await updateCharacter(campaignId, charId, fresh => ({ ...fresh, ...outcome }));
    io.to(ROOM).emit('rest:result', {
      characterId: charId, characterName: char.name, resting: true, restType: choice.restType,
      hpGained: outcome.hpGained, currentHp: outcome.currentHp, maxHp: outcome.maxHp,
      currentSpellSlots1: outcome.currentSpellSlots1, maxSpellSlots1: outcome.maxSpellSlots1,
      worldEvents,
    });
  }
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
      state = await generateWorldState(worldMd ?? '', factionsMd ?? '', adapter);
      if (state) { state.dayNumber = 1; state.totalHoursElapsed = 0; }
    }
    if (!state) return undefined;

    state.totalHoursElapsed += hours;
    state.dayNumber = Math.floor(state.totalHoursElapsed / 24) + 1;
    const newlyCompleted: string[] = [];

    for (const actor of state.actors) {
      if (actor.status !== 'active') continue;
      actor.daysElapsed += hours / 24;
      for (const ms of actor.milestones) {
        if (!ms.completed && actor.daysElapsed >= ms.day) {
          ms.completed = true;
          ms.completedOnDay = Math.floor(actor.daysElapsed);
          newlyCompleted.push(`${actor.name}: ${ms.description}`);
        }
      }
      const next = actor.milestones.find(m => !m.completed);
      if (next) actor.currentStatus = `Working toward: ${next.description}`;
      else if (actor.daysElapsed >= actor.totalDays) {
        actor.status = 'succeeded';
        actor.currentStatus = `Has achieved their ultimate goal: ${actor.ultimateGoal}`;
        newlyCompleted.push(`⚠️ ${actor.name} HAS SUCCEEDED: ${actor.ultimateGoal}`);
      }
    }

    const worldMd = await readCampaignFile(campaignId, 'world.md');
    const worldEvents = await tickWorldNarrative(state, hours, worldMd ?? '', newlyCompleted, adapter);
    await writeWorldState(campaignId, state);
    return worldEvents ?? undefined;
  } catch (err) {
    logError('socketHandlers/rest:tickWorldForRest', err);
    return undefined;
  }
}
