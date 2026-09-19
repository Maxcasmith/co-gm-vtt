import { readQuests, readManifest, getConfig } from '../storage.ts';
import { postChat } from '../partyGroups.ts';
import { ensureSessionQuests } from '../session-processor/index.ts';
import { io, campaignRoom, sessionState } from '../state.ts';
import { runRecap, endSession, isFirstSession } from '../session.ts';
import { getStoryboardQueue } from '../dungeon/storyboard.ts';
import { logError } from '../logger.ts';
import type { JoinContext } from './context.ts';

export function registerSessionHandlers(ctx: JoinContext): void {
  const { socket } = ctx;

  socket.on('session:start', ({ campaignId: cid }) => {
    sessionState.set(cid, true);
    io.to(campaignRoom(cid)).emit('session:state', true);
    io.to(campaignRoom(cid)).emit('dm:thinking', true);
    void (async () => {
      try {
        const config = await getConfig();
        if (!config.image.generateStoryboard || !(await isFirstSession(cid))) return;
        const queue = await getStoryboardQueue(cid);
        if (queue.entries.length) io.to(campaignRoom(cid)).emit('storyboard:queue', queue);
      } catch (err) {
        logError('socketHandlers/session:storyboardQueue', err);
      }
    })();
    void (async () => {
      try {
        await ensureSessionQuests(cid);
        const [quests, manifest] = await Promise.all([readQuests(cid), readManifest(cid)]);
        io.to(campaignRoom(cid)).emit('quest:update', { quests, act: manifest?.act ?? 1 });

        const { text } = await runRecap(cid);
        await postChat(cid, { text, senderName: 'Virtual DM', timestamp: Date.now() }, 'all',
          to => to.emit('session:recap', { text, senderName: 'Virtual DM' }));
      } catch (err) {
        logError('index:sessionStartRecap', err);
        io.to(campaignRoom(cid)).emit('session:recap', { text: 'The story begins...', senderName: 'Virtual DM' });
      } finally {
        io.to(campaignRoom(cid)).emit('dm:thinking', false);
      }
    })();
  });

  socket.on('session:end', ({ campaignId: cid }) => { endSession(cid); });
}
