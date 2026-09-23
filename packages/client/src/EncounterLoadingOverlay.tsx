import { useEffect, useRef, useState } from 'react';
import { on } from './events.ts';

interface Props {
  /** Raised while this overlay is up, so GamePage can hold the party's inputs for exactly as long
   * as the screen covers them — it has no other way to know, the sequence lives in here. */
  onActiveChange?: (active: boolean) => void;
}

export default function EncounterLoadingOverlay({ onActiveChange }: Props) {
  const [visible, setVisible]       = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [enemiesReady, setEnemiesReady] = useState(false);
  const [generating, setGenerating] = useState(false);

  // encounter:ready means the stat blocks exist, NOT that the fight is on screen — the arena's
  // enemies and floor art land with the dungeon broadcast beside it, and their images decode after
  // that. So the dismiss waits for Canvas's vtt:scene:ready instead, and encounter:ready only
  // records that the roster arrived. Both orderings happen (scene ready can land first for an
  // arena needing no new art), hence the ref'd pair rather than a useEffect on the two states:
  // React can batch a false-then-true flip into a single render and a dependency array would see
  // no net change.
  const enemiesReadyRef = useRef(false);
  const sceneReadyRef   = useRef(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearDismiss() {
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
  }

  function dismiss() {
    clearDismiss();
    setDismissing(true);
    setTimeout(() => setVisible(false), 500);
  }

  // Both halves in, so the map behind this is populated and painted — hold 600ms on "Encounter
  // ready!" so the transition reads as finished rather than as a flicker.
  function maybeDismiss() {
    if (!enemiesReadyRef.current || !sceneReadyRef.current) return;
    clearDismiss();
    dismissTimerRef.current = setTimeout(dismiss, 600);
  }

  useEffect(() => {
    const unsubCombat = on('vtt:combat:state', ({ active }) => {
      if (active) {
        clearDismiss();
        enemiesReadyRef.current = false;
        setVisible(true);
        setDismissing(false);
        setEnemiesReady(false);
        setGenerating(false);
      } else {
        dismiss();
      }
    });
    const unsubGen     = on('vtt:encounter:generating', () => setGenerating(true));
    const unsubEnemies = on('vtt:encounter:ready',      () => { enemiesReadyRef.current = true; setEnemiesReady(true); maybeDismiss(); });
    // A scene that stops being ready cancels a dismiss already in flight: the arena's finished map
    // and its encounter:ready arrive in the same socket batch, so encounter:ready is handled while
    // sceneReadyRef still holds the *empty* arena's answer from before generation — React hasn't
    // re-rendered Canvas with the populated one yet. The false lands a commit later, well inside
    // the 600ms hold.
    const unsubScene   = on('vtt:scene:ready',          ({ ready }) => {
      sceneReadyRef.current = ready;
      if (ready) maybeDismiss(); else clearDismiss();
    });
    // Generation threw — encounter:ready is never coming, so come down now rather than holding the
    // screen (and the party's inputs) for a fight that will have to be resolved narratively.
    const unsubFailed  = on('vtt:encounter:failed',     dismiss);
    return () => { unsubCombat(); unsubGen(); unsubEnemies(); unsubScene(); unsubFailed(); };
  }, []);

  useEffect(() => { onActiveChange?.(visible); }, [visible, onActiveChange]);

  if (!visible) return null;

  const progress = enemiesReady ? 100 : generating ? 60 : 20;

  const stage =
    enemiesReady ? 'Encounter ready!' :
    generating   ? 'Summoning enemies…' :
                   'Preparing encounter…';

  return (
    <div className={`encounter-overlay${dismissing ? ' encounter-overlay--out' : ''}`}>
      <div className="encounter-overlay-content">
        <div className="encounter-spinner" />
        <p className="encounter-stage">{stage}</p>
        <progress className="encounter-progress" value={progress} max={100} />
      </div>
    </div>
  );
}
