import { useEffect, useRef } from 'react';
import type { Player } from 'shared';
import './app.css';

interface Props {
  player: Player;
  connected: Player[];
}

export default function Canvas({ player, connected }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#e0e0e0';
    ctx.font = '14px monospace';
    ctx.fillText(`You: ${player}`, 20, 40);

    ctx.fillStyle = '#888';
    ctx.fillText('Connected:', 20, 80);

    connected.forEach((p, i) => {
      ctx.fillStyle = p === player ? '#7eb8f7' : '#c0c0c0';
      ctx.fillText(`• ${p}`, 20, 100 + i * 24);
    });
  }, [player, connected]);

  return <canvas ref={ref} className="canvas" />;
}
