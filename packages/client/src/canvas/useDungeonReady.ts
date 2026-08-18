import { useEffect, useState } from 'react';
import type { Dungeon } from 'shared';
import { dungeonTexturesReady } from '../dungeonThemes.ts';

// Polls (rAF) until every floor texture the dungeon's rooms reference has finished decoding —
// lets the caller hide the map behind a loading screen instead of rooms popping in
// texture-by-texture as each image resolves (see dungeonThemes.ts's getImage/textureLoadVersion).
export function useDungeonReady(dungeon: Dungeon | undefined, dungeonGenerating: boolean): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!dungeon || dungeonGenerating) { setReady(false); return; }
    if (dungeonTexturesReady(dungeon)) { setReady(true); return; }
    setReady(false);
    let raf = requestAnimationFrame(function check() {
      if (dungeonTexturesReady(dungeon)) { setReady(true); return; }
      raf = requestAnimationFrame(check);
    });
    return () => cancelAnimationFrame(raf);
  }, [dungeon, dungeonGenerating]);

  return ready;
}
