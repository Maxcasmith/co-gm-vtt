import { useState, useEffect } from 'react';
import type { TurnOrderEntry } from 'shared';
import { on } from './events.ts';

const API = `http://${window.location.hostname}:3001`;

interface Props {
  campaignId: string;
}

export default function TurnOrderBar({ campaignId }: Props) {
  const [entries, setEntries]         = useState<TurnOrderEntry[]>([]);
  const [actorName, setActorName]     = useState<string | null>(null);
  const [newIds, setNewIds]           = useState<Set<string>>(new Set());

  useEffect(() => on('vtt:combat:state', ({ active }) => {
    if (!active) { setEntries([]); setActorName(null); setNewIds(new Set()); }
  }), []);

  useEffect(() => on('vtt:combat:initiative', ({ entry }) => {
    setEntries(prev => {
      const next = [...prev.filter(e => e.id !== entry.id), entry];
      return next.sort((a, b) => b.initiative - a.initiative);
    });
    setNewIds(prev => {
      const next = new Set(prev);
      next.add(entry.id);
      setTimeout(() => setNewIds(s => { const n = new Set(s); n.delete(entry.id); return n; }), 600);
      return next;
    });
  }), []);

  useEffect(() => on('vtt:combat:turn:order', ({ entries: all }) => {
    setEntries(all);
  }), []);

  useEffect(() => on('vtt:combat:turn', ({ actorName: name }) => setActorName(name)), []);

  if (!entries.length) return null;

  return (
    <div className="turn-order-bar">
      {entries.map(entry => {
        const isCurrent = entry.name === actorName;
        const isNew     = newIds.has(entry.id);
        const portrait  = entry.isPlayer
          ? `${API}/api/campaigns/${campaignId}/party/${entry.id}/portrait`
          : null;

        return (
          <div
            key={entry.id}
            className={`turn-order-card${isCurrent ? ' turn-order-card--active' : ''}${isNew ? ' turn-order-card--enter' : ''}`}
          >
            <div className="turn-order-avatar">
              {portrait
                ? <img src={portrait} alt={entry.name} className="turn-order-portrait" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                : null
              }
              <span className="turn-order-initial">{entry.name[0]?.toUpperCase()}</span>
            </div>
            <span className="turn-order-name">{entry.name.split(' ')[0]}</span>
            <span className="turn-order-init">{entry.initiative}</span>
          </div>
        );
      })}
    </div>
  );
}
