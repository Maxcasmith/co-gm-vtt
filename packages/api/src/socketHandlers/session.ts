import { readQuests, readManifest, appendChatLog } from '../storage.ts';
import { ensureSessionQuests } from '../session-processor/index.ts';
import { io, ROOM, sessionState } from '../state.ts';
import { runRecap, endSession } from '../session.ts';
import { logError } from '../logger.ts';
import type { JoinContext } from './context.ts';

export function registerSessionHandlers(ctx: JoinContext): void {
  const { socket } = ctx;

  socket.on('session:start', ({ campaignId: cid }) => {
    sessionState.set(cid, true);
    io.to(ROOM).emit('session:state', true);
    io.to(ROOM).emit('dm:thinking', true);
    void (async () => {
      try {
        await ensureSessionQuests(cid);
        const [quests, manifest] = await Promise.all([readQuests(cid), readManifest(cid)]);
        io.to(ROOM).emit('quest:update', { quests, act: manifest?.act ?? 1 });

        const { text } = await runRecap(cid);
        await appendChatLog(cid, { text, senderName: 'Virtual DM', timestamp: Date.now() });
        io.to(ROOM).emit('session:recap', { text, senderName: 'Virtual DM' });
      } catch (err) {
        logError('index:sessionStartRecap', err);
        io.to(ROOM).emit('session:recap', { text: 'The story begins...', senderName: 'Virtual DM' });
      } finally {
        io.to(ROOM).emit('dm:thinking', false);
      }
    })();
  });

  socket.on('session:end', ({ campaignId: cid }) => { endSession(cid); });
}
