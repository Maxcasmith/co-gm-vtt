import type { ReactionOffer } from 'shared';
import { io, playerSocketIds } from '../../state.ts';

/** How long a player has to answer a reaction offer before it auto-declines. */
export const REACTION_WINDOW_MS = 6000;

// requestId → resolver for the in-flight offer. Module-level rather than per-engine because the
// socket handler that answers has no engine reference — it only knows the requestId it was sent.
const pending = new Map<string, (accepted: boolean) => void>();

/**
 * Offers a reaction to one player and waits for their answer, suspending the attack resolution
 * that called it. Resolves false on timeout, on a disconnected player, or on an explicit decline —
 * so a caller can always treat a false as "carry on unchanged".
 */
export function offerReaction(
  charId: string,
  offer: Omit<ReactionOffer, 'requestId' | 'expiresInMs'>,
  timeoutMs = REACTION_WINDOW_MS,
): Promise<boolean> {
  const socketId = playerSocketIds.get(charId);
  if (!socketId) return Promise.resolve(false);

  const requestId = crypto.randomUUID();
  io.to(socketId).emit('combat:reaction:offer', { ...offer, requestId, expiresInMs: timeoutMs });
  console.log(`[reaction] offering ${offer.spellName} to ${charId} (${offer.attackTotal} vs AC ${offer.currentAc}→${offer.boostedAc})`);

  return new Promise<boolean>(resolve => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      io.to(socketId).emit('combat:reaction:close', { requestId });
      console.log(`[reaction] ${offer.spellName} offer timed out`);
      resolve(false);
    }, timeoutMs);

    pending.set(requestId, accepted => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(accepted);
    });
  });
}

/** Called by the socket handler when a player answers. Unknown ids are ignored (already timed out). */
export function resolveReaction(requestId: string, accepted: boolean): void {
  pending.get(requestId)?.(accepted);
}
