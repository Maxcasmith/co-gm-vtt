import type { Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, Player } from 'shared';

// Every per-connection handler is registered inside the player:join callback (see index.ts),
// so all of them close over the same joined player's identity — passed here as one context
// object instead of each handler re-destructuring the join payload.
export interface JoinContext {
  socket: Socket<ClientToServerEvents, ServerToClientEvents>;
  player: Player;
  charId: string;
  campaignId: string;
}
