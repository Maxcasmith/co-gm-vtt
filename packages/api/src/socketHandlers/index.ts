import { io } from '../state.ts';
import { registerJoin, registerDisconnectHandler } from './connection.ts';
import { registerSessionHandlers } from './session.ts';
import { registerRollHandlers } from './rolls.ts';
import { registerChatHandlers } from './chat.ts';
import { registerCombatHandlers } from './combat.ts';
import { registerInventoryHandlers } from './inventory.ts';
import { registerRestHandlers } from './rest.ts';
import type { JoinContext } from './context.ts';

export function registerSocketHandlers(): void {
  io.on('connection', (socket) => {
    socket.on('player:join', ({ name: player, id: charId, campaignId }) => {
      const ctx: JoinContext = { socket, player, charId, campaignId };
      registerJoin(ctx);
      registerSessionHandlers(ctx);
      registerRollHandlers(ctx);
      registerChatHandlers(ctx);
      registerCombatHandlers(ctx);
      registerInventoryHandlers(ctx);
      registerRestHandlers(ctx);
      registerDisconnectHandler(ctx);
    });
  });
}
