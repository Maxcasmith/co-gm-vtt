import { useEffect, useState } from 'react';
import { on } from './events.ts';

export default function EncounterLoadingOverlay() {
  const [visible, setVisible]       = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [mapReady, setMapReady]     = useState(false);
  const [enemiesReady, setEnemiesReady] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    const unsubCombat = on('vtt:combat:state', ({ active }) => {
      if (active) {
        setVisible(true);
        setDismissing(false);
        setMapReady(false);
        setEnemiesReady(false);
        setGenerating(false);
      } else {
        setDismissing(true);
        setTimeout(() => setVisible(false), 500);
      }
    });
    const unsubGen     = on('vtt:encounter:generating', () => setGenerating(true));
    const unsubMap     = on('vtt:map:generated',        () => setMapReady(true));
    const unsubEnemies = on('vtt:encounter:ready',      () => setEnemiesReady(true));
    return () => { unsubCombat(); unsubGen(); unsubMap(); unsubEnemies(); };
  }, []);

  useEffect(() => {
    if (mapReady && enemiesReady) {
      const t = setTimeout(() => {
        setDismissing(true);
        setTimeout(() => setVisible(false), 500);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [mapReady, enemiesReady]);

  if (!visible) return null;

  const progress = [generating, enemiesReady, mapReady].filter(Boolean).length * 33 + (mapReady && enemiesReady ? 1 : 0);

  const stage =
    mapReady && enemiesReady ? 'Encounter ready!' :
    mapReady                 ? 'Summoning enemies…' :
    enemiesReady             ? 'Rendering battlefield…' :
    generating               ? 'Summoning enemies…' :
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
