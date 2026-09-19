import { Participant } from '../../domain/encounter.ts';
import { toFightOf } from '../../state.ts';

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Pushes a participant's remaining action economy to the room so the combat dock can show it. */
export function emitResources(cid: string, participant: Participant): void {
  toFightOf(cid, participant.id).emit('combat:player:resources', {
    characterId: participant.id,
    actionsRemaining: participant.actionsRemaining,
    bonusActionsRemaining: participant.bonusActionsRemaining,
    reactionsRemaining: participant.reactionsRemaining,
  });
}
