import { useEffect, type RefObject } from 'react';
import type { Dungeon } from 'shared';
import { dispatch } from '../events.ts';
import { dungeonTexturesReady } from '../dungeonThemes.ts';

// Announces (vtt:scene:ready) whether EVERYTHING the current scene draws has actually landed: the
// tileset manifest fetched, every floor texture decoded, and every token/portrait/prop image
// settled (loaded or 404'd — see Canvas's pendingAssetsRef). The loading overlays come down on
// this and nothing else, so anything not covered here is something the party watches pop in on a
// bare map behind an already-dismissed loading screen — which is what happened while this only
// waited on floor textures.
//
// Polls rAF rather than subscribing: what it waits on is <img> decodes and a fetch, none of which
// are React state. Announced from inside the check itself, never from a useEffect on the returned
// value — a scene that is still ready after a change produces no state change to react to, and one
// that has just stopped being ready would be announced with the previous render's answer.
//
// The synchronous first check matters: a dungeon rebroadcast (a door opening, a room marked
// visited) hands us a new object for a scene whose art is all already cached, and must answer
// "ready" in the same tick rather than blinking the overlay back up for two frames.
export function useSceneReady(dungeon: Dungeon | undefined, pendingAssetsRef: RefObject<number>): void {
  useEffect(() => {
    const settled = () => pendingAssetsRef.current === 0 && (!dungeon || dungeonTexturesReady(dungeon));
    if (settled()) { dispatch('vtt:scene:ready', { ready: true }); return; }

    dispatch('vtt:scene:ready', { ready: false });
    // Two clear frames, not one: the frame that finishes the last image isn't the frame that draws
    // it (Canvas's draw is itself rAF-scheduled off a React commit), so announcing on the first
    // would report "rendered" one frame before it is on screen.
    let clear = 0;
    let raf = requestAnimationFrame(function check() {
      clear = settled() ? clear + 1 : 0;
      if (clear >= 2) { dispatch('vtt:scene:ready', { ready: true }); return; }
      raf = requestAnimationFrame(check);
    });
    return () => cancelAnimationFrame(raf);
  }, [dungeon, pendingAssetsRef]);
}
