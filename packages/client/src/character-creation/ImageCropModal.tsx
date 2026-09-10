import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button/Button.tsx';

interface Props {
  file: File | null;
  onCancel: () => void;
  onConfirm: (base64: string) => void;
}

const VIEWPORT = 320;
const OUTPUT = 800;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

type Offset = { x: number; y: number };

export default function ImageCropModal({ file, onCancel, onConfirm }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const baseScaleRef = useRef(1);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });

  const clampOffset = useCallback((x: number, y: number, z: number): Offset => {
    const img = imgRef.current;
    if (!img) return { x, y };
    const w = img.naturalWidth * baseScaleRef.current * z;
    const h = img.naturalHeight * baseScaleRef.current * z;
    return { x: Math.min(0, Math.max(VIEWPORT - w, x)), y: Math.min(0, Math.max(VIEWPORT - h, y)) };
  }, []);

  useEffect(() => {
    if (!file) { setReady(false); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      baseScaleRef.current = VIEWPORT / Math.min(img.naturalWidth, img.naturalHeight);
      const w = img.naturalWidth * baseScaleRef.current;
      const h = img.naturalHeight * baseScaleRef.current;
      setZoom(1);
      setOffset({ x: (VIEWPORT - w) / 2, y: (VIEWPORT - h) / 2 });
      setReady(true);
    };
    img.src = url;
    return () => { URL.revokeObjectURL(url); imgRef.current = null; setReady(false); };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !img || !ctx) return;
    ctx.clearRect(0, 0, VIEWPORT, VIEWPORT);
    ctx.drawImage(img, offset.x, offset.y, img.naturalWidth * baseScaleRef.current * zoom, img.naturalHeight * baseScaleRef.current * zoom);
  }, [zoom, offset, ready]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clampOffset(d.origX + (e.clientX - d.startX), d.origY + (e.clientY - d.startY), zoom));
  }

  function onZoomChange(z: number) {
    const img = imgRef.current;
    if (!img) return;
    const center = VIEWPORT / 2;
    const prevW = img.naturalWidth * baseScaleRef.current * zoom;
    const prevH = img.naturalHeight * baseScaleRef.current * zoom;
    const relX = (center - offset.x) / prevW;
    const relY = (center - offset.y) / prevH;
    const nextW = img.naturalWidth * baseScaleRef.current * z;
    const nextH = img.naturalHeight * baseScaleRef.current * z;
    setZoom(z);
    setOffset(clampOffset(center - relX * nextW, center - relY * nextH, z));
  }

  function handleConfirm() {
    const img = imgRef.current;
    if (!img) return;
    const out = document.createElement('canvas');
    out.width = OUTPUT;
    out.height = OUTPUT;
    const ctx = out.getContext('2d');
    if (!ctx) return;
    const scale = OUTPUT / VIEWPORT;
    ctx.drawImage(
      img,
      offset.x * scale,
      offset.y * scale,
      img.naturalWidth * baseScaleRef.current * zoom * scale,
      img.naturalHeight * baseScaleRef.current * zoom * scale,
    );
    onConfirm(out.toDataURL('image/jpeg', 0.92).split(',')[1] ?? '');
  }

  if (!file) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <dialog className="modal crop-modal" open onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Position Portrait</h2>
        <p className="modal-hint">Drag to reposition, use the slider to zoom. This framing is used for the portrait and the token — the dashed circle shows the token crop.</p>

        <div className="crop-canvas-wrap">
          <canvas
            ref={canvasRef}
            width={VIEWPORT}
            height={VIEWPORT}
            className="crop-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => { dragRef.current = null; }}
            onPointerLeave={() => { dragRef.current = null; }}
          />
          <div className="crop-token-guide" />
        </div>

        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          disabled={!ready}
          onChange={e => onZoomChange(Number(e.target.value))}
          className="crop-zoom-slider"
        />

        <div className="modal-actions">
          <Button variant="outline" color="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!ready}>Use Photo</Button>
        </div>
      </dialog>
    </div>
  );
}
