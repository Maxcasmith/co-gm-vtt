import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { Player } from 'shared';
import Canvas from './Canvas.tsx';
import './app.css';

const PLAYERS: Player[] = ['GM', 'P1'];

function getPlayer(): Player | null {
  const param = new URLSearchParams(window.location.search).get('player');
  return PLAYERS.includes(param as Player) ? (param as Player) : null;
}

export default function SandboxPage() {
  const player = getPlayer();
  const [connected, setConnected] = useState<Player[]>([]);

  useEffect(() => {
    if (!player) return;
    const socket = io(`http://${window.location.hostname}:3001`);
    socket.emit('player:join', player);
    socket.on('players:update', setConnected);
    return () => { socket.disconnect(); };
  }, [player]);

  if (!player) {
    return <div className="error">Unknown player — use ?player=GM or ?player=P1</div>;
  }

  return <Canvas player={player} connected={connected} />;
}
