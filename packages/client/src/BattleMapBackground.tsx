import { useEffect, useState } from 'react';
import { on, dispatch } from './events.ts';

const API = `http://${window.location.hostname}:3001`;

interface Props { campaignId: string }

export default function BattleMapBackground({ campaignId }: Props) {
  const [mapUrl, setMapUrl]       = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [visible, setVisible]     = useState(false);

  useEffect(() => {
    (window as Record<string, unknown>).loadMap = (mapId: string) => {
      dispatch('vtt:combat:state', { active: true });
      dispatch('vtt:map:generated', { mapId, campaignId });
    };
    return () => { delete (window as Record<string, unknown>).loadMap; };
  }, [campaignId]);

  useEffect(() => {
    const unsubCombat = on('vtt:combat:state', ({ active }) => {
      if (!active) { setVisible(false); setGenerating(false); }
    });
    const unsubGen = on('vtt:map:generating', () => {
      setGenerating(true);
      setVisible(true);
    });
    const unsubDone = on('vtt:map:generated', ({ mapId }) => {
      setMapUrl(`${API}/api/campaigns/${campaignId}/maps/${mapId}`);
      setGenerating(false);
      setVisible(true);
    });
    return () => { unsubCombat(); unsubGen(); unsubDone(); };
  }, [campaignId]);

  if (!visible) return null;

  return (
    <div className="battle-map-bg">
      {generating && (
        <div className="battle-map-generating">
          <span className="battle-map-generating-dot" />
          Generating map…
        </div>
      )}
      {mapUrl && <img className="battle-map-img" src={mapUrl} alt="Battle map" />}
    </div>
  );
}
