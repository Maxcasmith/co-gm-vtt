import { Participant } from '../../domain/encounter.ts';
import { io, ROOM } from '../../state.ts';

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Pushes a participant's remaining action economy to the room so the combat dock can show it. */
export function emitResources(participant: Participant): void {
  io.to(ROOM).emit('combat:player:resources', {
    characterId: participant.id,
    actionsRemaining: participant.actionsRemaining,
    bonusActionsRemaining: participant.bonusActionsRemaining,
    reactionsRemaining: participant.reactionsRemaining,
  });
}
