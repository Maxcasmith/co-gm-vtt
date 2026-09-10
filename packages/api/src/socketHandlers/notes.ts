import { appendNote } from '../storage.ts';
import { io, ROOM } from '../state.ts';
import type { JoinContext } from './context.ts';

export function registerNoteHandlers(ctx: JoinContext): void {
  const { socket, campaignId } = ctx;

  socket.on('note:add', ({ text, authorName, pinnedBy }) => {
    void (async () => {
      const payload = { text, authorName, timestamp: Date.now(), ...(pinnedBy ? { pinnedBy } : {}) };
      await appendNote(campaignId, payload);
      io.to(ROOM).emit('note:added', payload);
    })();
  });
}
