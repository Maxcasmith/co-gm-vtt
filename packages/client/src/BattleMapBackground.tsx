import { useEffect, useRef, useState } from 'react';
import { on, dispatch } from './events.ts';

const API = `http://${window.location.hostname}:3001`;

interface Props { campaignId: string; worldMapUrl?: string }

interface Vp { x: number; y: number; zoom: number }

function setTransform(el: HTMLImageElement | null, { x, y, zoom }: Vp) {
  if (el) el.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
}

export default function BattleMapBackground({ campaignId, worldMapUrl }: Props) {
  const [mapUrl, setMapUrl]         = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [visible, setVisible]       = useState(false);

  const battleImgRef = useRef<HTMLImageElement>(null);
  const battleVpRef  = useRef<Vp>({ x: 0, y: 0, zoom: 1 });

  const worldImgRef  = useRef<HTMLImageElement>(null);
  const worldVpRef   = useRef<Vp>({ x: 0, y: 0, zoom: 1 });
  const isPanningRef = useRef(false);
  const panStartRef  = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const divRef       = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (window as Record<string, unknown>).loadMap = (mapId: string) => {
      dispatch('vtt:combat:state', { active: true });
      dispatch('vtt:map:generated', { mapId, campaignId });
    };
    return () => { delete (window as Record<string, unknown>).loadMap; };
  }, [campaignId]);

  useEffect(() => {
    const u1 = on('vtt:combat:state', ({ active }) => {
      if (!active) {
        setVisible(false);
        setGenerating(false);
        battleVpRef.current = { x: 0, y: 0, zoom: 1 };
      }
    });
    const u2 = on('vtt:map:generating', () => { setGenerating(true); setVisible(true); });
    const u3 = on('vtt:map:generated', ({ mapId }) => {
      setMapUrl(`${API}/api/campaigns/${campaignId}/maps/${mapId}`);
      setGenerating(false);
      setVisible(true);
    });
    const u4 = on('vtt:viewport:changed', vp => {
      battleVpRef.current = vp;
      setTransform(battleImgRef.current, vp);
    });
    return () => { u1(); u2(); u3(); u4(); };
  }, [campaignId]);

  // Re-apply battle viewport whenever the img element mounts (mapUrl changes)
  useEffect(() => {
    setTransform(battleImgRef.current, battleVpRef.current);
  }, [mapUrl]);

  // World map pan/zoom — window listeners so drag tracks past div edge
  useEffect(() => {
    if (visible) return;
    function onMove(e: MouseEvent) {
      if (!isPanningRef.current) return;
      const { mx, my, px, py } = panStartRef.current;
      worldVpRef.current = { ...worldVpRef.current, x: px + (e.clientX - mx), y: py + (e.clientY - my) };
      setTransform(worldImgRef.current, worldVpRef.current);
    }
    function onUp() {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      if (divRef.current) divRef.current.style.cursor = 'default';
    }
    function onWheel(e: WheelEvent) {
      if (!worldImgRef.current) return;
      e.preventDefault();
      const { x: px, y: py, zoom: oz } = worldVpRef.current;
      const nz = Math.max(0.5, Math.min(2, oz * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const rect = divRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      worldVpRef.current = { x: mx - (mx - px) * (nz / oz), y: my - (my - py) * (nz / oz), zoom: nz };
      setTransform(worldImgRef.current, worldVpRef.current);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('wheel', onWheel);
    };
  }, [visible]);

  function onWorldMouseDown(e: React.MouseEvent) {
    if (e.button !== 2) return;
    e.preventDefault();
    isPanningRef.current = true;
    panStartRef.current = { mx: e.clientX, my: e.clientY, px: worldVpRef.current.x, py: worldVpRef.current.y };
    if (divRef.current) divRef.current.style.cursor = 'grabbing';
  }

  if (!visible) {
    if (!worldMapUrl) return null;
    return (
      <div
        ref={divRef}
        className="battle-map-bg"
        onMouseDown={onWorldMouseDown}
        onContextMenu={e => e.preventDefault()}
      >
        <img ref={worldImgRef} className="world-map-img" src={worldMapUrl} alt="World map" />
      </div>
    );
  }

  return (
    <div className="battle-map-bg">
      {generating && (
        <div className="battle-map-generating">
          <span className="battle-map-generating-dot" />
          Generating map…
        </div>
      )}
      {mapUrl && <img ref={battleImgRef} className="battle-map-img" src={mapUrl} alt="Battle map" />}
    </div>
  );
}
