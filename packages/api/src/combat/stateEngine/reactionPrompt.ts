import type { ReactionOfferOption } from 'shared';
import { io, playerSocketIds } from '../../state.ts';

/** How long a player has to answer a reaction offer before it auto-declines. */
export const REACTION_WINDOW_MS = 15000;

// requestId → resolver for the in-flight offer. Module-level rather than per-engine because the
// socket handler that answers has no engine reference — it only knows the requestId it was sent.
const pending = new Map<string, (spellName: string | null) => void>();

/**
 * Offers one player every reaction spell currently eligible at once (a hit landing might make
 * both a defend-shaped and a retaliate-shaped spell available) and waits for a single pick,
 * suspending the resolution that called it. Resolves null on timeout, on a disconnected player,
 * or on an explicit decline — so a caller can always treat null as "carry on unchanged".
 */
export function offerReaction(
  charId: string,
  options: ReactionOfferOption[],
  timeoutMs = REACTION_WINDOW_MS,
): Promise<string | null> {
  const socketId = playerSocketIds.get(charId);
  if (!socketId || !options.length) return Promise.resolve(null);

  const requestId = crypto.randomUUID();
  io.to(socketId).emit('combat:reaction:offer', { requestId, options, expiresInMs: timeoutMs });
  console.log(`[reaction] offering ${charId}: ${options.map(o => o.spellName).join(', ')}`);

  return new Promise<string | null>(resolve => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      io.to(socketId).emit('combat:reaction:close', { requestId });
      console.log(`[reaction] offer to ${charId} timed out`);
      resolve(null);
    }, timeoutMs);

    pending.set(requestId, spellName => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(spellName);
    });
  });
}

/** Called by the socket handler when a player answers. Unknown ids are ignored (already timed out). */
export function resolveReaction(requestId: string, spellName: string | null): void {
  pending.get(requestId)?.(spellName);
}
