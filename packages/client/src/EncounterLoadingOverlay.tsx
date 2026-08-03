import { useEffect, useRef, useState } from 'react';
import { on } from './events.ts';

export default function EncounterLoadingOverlay() {
  const [visible, setVisible]       = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [enemiesReady, setEnemiesReady] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Dismiss timer is scheduled imperatively from the encounter:ready handler itself, not derived
  // from an enemiesReady useEffect — React can batch a false-then-true flip (combat:state:true
  // resetting it, immediately followed by encounter:ready setting it back) into a single render,
  // which leaves the dependency array seeing no net change and the effect never re-firing. A ref'd
  // timer scheduled directly in the handler can't be swallowed by batching the same way.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleDismiss() {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setDismissing(true);
      setTimeout(() => setVisible(false), 500);
    }, 600);
  }

  useEffect(() => {
    const unsubCombat = on('vtt:combat:state', ({ active }) => {
      if (active) {
        if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
        setVisible(true);
        setDismissing(false);
        setEnemiesReady(false);
        setGenerating(false);
      } else {
        setDismissing(true);
        setTimeout(() => setVisible(false), 500);
      }
    });
    const unsubGen     = on('vtt:encounter:generating', () => setGenerating(true));
    const unsubEnemies = on('vtt:encounter:ready',      () => { setEnemiesReady(true); scheduleDismiss(); });
    return () => { unsubCombat(); unsubGen(); unsubEnemies(); };
  }, []);

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
