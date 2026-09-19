import { updateCharacter } from '../../storage.ts';
import { Participant } from '../../domain/encounter.ts';
import { io, campaignRoom, fightOf, playerSocketIds, getStateEngine } from '../../state.ts';
import { D20Roll } from '../dice.ts';
import { advanceTurn } from './lifecycle.ts';
import { delay } from './shared.ts';
import { postChat } from '../../partyGroups.ts';

export async function runDeathSave(cid: string, actor: Participant): Promise<void> {
  const encounter = fightOf(cid, actor.id);
  if (!encounter) return;

  const participant = encounter.findParticipant(actor.id);
  if (!participant) return;
  const saves = participant.deathSaves;

  if (saves.stable) { advanceTurn(cid, encounter); return; }

  const roll = new D20Roll().roll();
  const isNat20 = roll === 20;
  const isNat1 = roll === 1;
  let stable = false;
  let dead = false;

  if (isNat20) {
    participant.currentHp = 1;
    void updateCharacter(cid, actor.id, c => ({ ...c, currentHp: 1 }));
    io.to(campaignRoom(cid)).emit('combat:player:damage', {
      characterId: actor.id,
      characterName: actor.name,
      damage: -1,
      currentHp: 1,
      maxHp: participant.maxHp,
      tempHp: participant.tempHp,
    });
    saves.successes = 3;
    stable = true;
    saves.stable = true;
  } else if (isNat1) {
    saves.failures = Math.min(3, saves.failures + 2);
  } else if (roll >= 10) {
    saves.successes = Math.min(3, saves.successes + 1);
  } else {
    saves.failures = Math.min(3, saves.failures + 1);
  }

  if (!stable && saves.successes >= 3) { stable = true; saves.stable = true; }
  if (saves.failures >= 3) dead = true;

  const saveData = {
    characterName: actor.name, roll, isNatural20: isNat20, isNatural1: isNat1,
    success: roll >= 10, successes: saves.successes, failures: saves.failures, stable, dead,
  };
  const socketId = playerSocketIds.get(actor.id);
  if (socketId) io.to(socketId).emit('combat:death:save', saveData);

  // Only the terminal outcomes below (stabilize/miracle/death) ever reached the journal — the
  // roll-by-roll saves leading up to them (or a plain ongoing failure/success) had no record at
  // all anywhere but the dying player's own private HUD event above.
  if (!(isNat20 || (stable && !isNat20))) {
    const saveMsg = {
      text: `${actor.name} rolls a death save: ${roll}${isNat1 ? ' (natural 1, counts double)' : ''} — ${roll >= 10 ? 'SUCCESS' : 'FAILURE'} (${saves.successes}/3 successes, ${saves.failures}/3 failures).`,
      senderName: 'System', timestamp: Date.now(),
    };
    void postChat(cid, saveMsg, [actor.id]);
  }

  if (dead) {
    await markPlayerDead(cid, participant, actor.id);
  } else if (stable && !isNat20) {
    const stableMsg = { text: `${actor.name} has stabilized.`, senderName: 'Combat', timestamp: Date.now() };
    void postChat(cid, stableMsg, [actor.id]);
  } else if (isNat20) {
    const miracleMsg = { text: `${actor.name} surges back to life!`, senderName: 'Combat', timestamp: Date.now() };
    void postChat(cid, miracleMsg, [actor.id]);
  }

  await delay(1500);
  // Re-resolved after the wait — the fight may have ended, or merged into another, meanwhile.
  const now = fightOf(cid, actor.id);
  if (now?.currentActor?.id === actor.id) advanceTurn(cid, now);
}

/**
 * Spare the Dying's "the creature becomes Stable" — sets deathSaves.stable directly instead of
 * rolling, same shape runDeathSave's nat-20/3-successes branches already leave behind. Player-only:
 * creatures have no death-save tracking in this engine (they just die outright at 0 HP), so this
 * silently no-ops for a non-player target, an already-stable one, one that's still standing, or
 * one that's already truly dead (3 failures).
 */
export async function stabilizeParticipant(cid: string, participant: Participant): Promise<void> {
  if (!participant.isPlayer || !participant.isDown() || participant.isDead() || participant.deathSaves.stable) return;
  participant.deathSaves.stable = true;
  const socketId = playerSocketIds.get(participant.id);
  if (socketId) {
    io.to(socketId).emit('combat:death:save', {
      characterName: participant.name, roll: 0, isNatural20: false, isNatural1: false,
      success: true, successes: participant.deathSaves.successes, failures: participant.deathSaves.failures,
      stable: true, dead: false,
    });
  }
  const stableMsg = { text: `${participant.name} has stabilized.`, senderName: 'Combat', timestamp: Date.now() };
  void postChat(cid, stableMsg, [participant.id]);
}

/**
 * Single place a player character is declared dead. Both routes here (failing a third death save,
 * and being hit while already at 0 HP) used to inline these same three emits, which meant an
 * `onKill` hook wired into one would silently miss the other.
 */
export async function markPlayerDead(cid: string, participant: Participant, charId: string, sourceId?: string): Promise<void> {
  io.to(campaignRoom(cid)).emit('combat:player:dead', { characterId: charId, characterName: participant.name });
  const deadMsg = { text: `${participant.name} has perished.`, senderName: 'Combat', timestamp: Date.now() };
  void postChat(cid, deadMsg, [participant.id]);
  await getStateEngine(cid).trigger('onKill', {
    participantId: charId, participantName: participant.name, isPlayer: true, sourceId,
  });
}

