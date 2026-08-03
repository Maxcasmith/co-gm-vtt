import { useEffect, useRef } from 'react';

interface Props { worldMapUrl?: string }

export default function BattleMapBackground({ worldMapUrl }: Props) {
  const vpRef         = useRef({ x: 0, y: 0, zoom: 1 });
  const imgRef        = useRef<HTMLImageElement>(null);
  const isPanningRef  = useRef(false);
  const panStartRef   = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const divRef        = useRef<HTMLDivElement>(null);

  function setTransform() {
    const { x, y, zoom } = vpRef.current;
    if (imgRef.current) imgRef.current.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
  }

  // Window-level listeners so drag tracks past the div edge
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isPanningRef.current) return;
      const { mx, my, px, py } = panStartRef.current;
      vpRef.current = { ...vpRef.current, x: px + (e.clientX - mx), y: py + (e.clientY - my) };
      setTransform();
    }
    function onUp() {
      if (!isPanningRef.current) return;
      isPanningRef.current = false;
      if (divRef.current) divRef.current.style.cursor = 'default';
    }
    function onWheel(e: WheelEvent) {
      if (!divRef.current || !divRef.current.contains(e.target as Node)) return;
      e.preventDefault();
      const { x: px, y: py, zoom: oz } = vpRef.current;
      const nz = Math.max(0.5, Math.min(2, oz * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const rect = divRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      vpRef.current = { x: mx - (mx - px) * (nz / oz), y: my - (my - py) * (nz / oz), zoom: nz };
      setTransform();
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);

  function onMouseDown(e: React.MouseEvent) {
    if (e.button !== 2) return;
    e.preventDefault();
    isPanningRef.current = true;
    panStartRef.current = { mx: e.clientX, my: e.clientY, px: vpRef.current.x, py: vpRef.current.y };
    if (divRef.current) divRef.current.style.cursor = 'grabbing';
  }

  if (!worldMapUrl) return null;

  return (
    <div
      ref={divRef}
      className="battle-map-bg"
      onMouseDown={onMouseDown}
      onContextMenu={e => e.preventDefault()}
    >
      <img ref={imgRef} className="world-map-img" src={worldMapUrl} alt="World map" />
    </div>
  );
}
