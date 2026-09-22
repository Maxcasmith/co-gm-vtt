import { useEffect, useState } from 'react';
import type { AlertPause, Character } from 'shared';
import { dispatch, on } from './events.ts';
import { Button } from './components/Button/Button.tsx';
import './styles/alert-swap.css';

const API = `http://${window.location.hostname}:3001`;

interface Props {
  character: Character;
  portraitUrls: Record<string, string>;
}

/**
 * Origin feat Alert's post-initiative pause (server: beginAlertPause). Alert players still deciding
 * get the swap sidebar; everyone else gets a "X is in Initiative Swap" banner. Every Alert player's
 * unconfirmed pick is broadcast (combat:alert:preview), so they all see what the others are eyeing.
 */
export default function AlertSwapSidebar({ character, portraitUrls }: Props) {
  const [pause, setPause] = useState<AlertPause | null>(null);
  // Alert player id → the ally they currently have selected.
  const [picks, setPicks] = useState<Record<string, string | null>>({});
  // Mirrors the server's per-player window (alertSwapTimeoutSecs) — the server auto-cancels on its own clock, this is display only.
  const [msLeft, setMsLeft] = useState(0);

  useEffect(() => {
    const clear = () => { setPause(null); setPicks({}); };
    const unsubs = [
      on('vtt:combat:alert:pause', payload => { setPause(payload); setPicks({}); setMsLeft(payload.expiresInMs ?? 0); }),
      on('vtt:combat:alert:preview', ({ characterId, targetId }) => setPicks(prev => ({ ...prev, [characterId]: targetId }))),
      on('vtt:combat:alert:resolved', ({ pendingNames }) => setPause(prev => (prev ? { ...prev, pendingNames } : prev))),
      // Another Alert player's confirmed swap moves numbers mid-pause — keep the grid honest.
      on('vtt:combat:initiative', ({ entry }) => setPause(prev => (prev ? { ...prev, roster: prev.roster.map(r => (r.id === entry.id ? { ...r, initiative: entry.initiative } : r)) } : prev))),
      on('vtt:combat:alert:pause:end', clear),
      on('vtt:combat:state', ({ active }) => { if (!active) clear(); }),
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, []);

  const timed = !!pause?.expiresInMs;
  useEffect(() => {
    if (!timed) return;
    const tick = setInterval(() => setMsLeft(prev => Math.max(0, prev - 100)), 100);
    return () => clearInterval(tick);
  }, [timed]);

  if (!pause?.pendingNames.length) return null;

  const secondsLeft = timed ? ` — ${Math.ceil(msLeft / 1000)}s` : '';

  if (!pause.pendingNames.includes(character.name)) {
    return (
      <div className="alert-swap-banner" role="status">
        {pause.pendingNames.map(name => <p key={name}>{name} is in Initiative Swap{secondsLeft}</p>)}
      </div>
    );
  }

  const me = pause.roster.find(r => r.id === character.id);
  const allies = pause.roster.filter(r => r.id !== character.id);
  const myPick = picks[character.id] ?? null;
  const target = allies.find(a => a.id === myPick);
  const nameOf = (id: string) => pause.roster.find(r => r.id === id)?.name;
  // Other Alert players whose live pick is `id`.
  const eyeing = (id: string) => Object.entries(picks).filter(([who, t]) => who !== character.id && t === id).map(([who]) => nameOf(who)).filter(Boolean).join(', ');

  const toggle = (id: string) => dispatch('vtt:combat:alert:select', { characterId: character.id, targetId: myPick === id ? null : id });
  const resolve = (targetId: string | null) => dispatch('vtt:combat:alert:resolve', { characterId: character.id, targetId });

  const portrait = (name: string, portraitSrc?: string) => {
    const src = portraitUrls[name] ?? (portraitSrc ? `${API}${portraitSrc}` : undefined);
    return src
      ? <img className="alert-swap-portrait" src={src} alt="" draggable={false} />
      : <span className="alert-swap-portrait alert-swap-portrait--initial">{name[0]?.toUpperCase()}</span>;
  };

  const score = (initiative: number | undefined, preview: number | undefined) => (
    <span className="alert-swap-score">
      {preview !== undefined && <span className="alert-swap-preview">{preview}</span>}
      <span className="alert-swap-init">{initiative ?? '—'}</span>
    </span>
  );

  const myEyers = eyeing(character.id);

  return (
    <aside className="alert-swap-sidebar" aria-label="Initiative Swap">
      <div className="alert-swap-header">
        <p className="alert-swap-eyebrow">Alert — Initiative Swap{secondsLeft}</p>
        {timed && <progress className="alert-swap-timer" max={pause.expiresInMs} value={msLeft} />}
      </div>

      <div className="alert-swap-me">
        {portrait(character.name)}
        <span className="alert-swap-name">{character.name}</span>
        {score(me?.initiative, target?.initiative)}
        {myEyers && <span className="alert-swap-eyeing">{myEyers} eyeing</span>}
      </div>

      <div className="alert-swap-grid">
        {allies.map(ally => {
          const selected = ally.id === myPick;
          const eyers = eyeing(ally.id);
          return (
            <button
              key={ally.id}
              type="button"
              aria-pressed={selected}
              className={`alert-swap-card${selected ? ' alert-swap-card--selected' : ''}${eyers ? ' alert-swap-card--eyed' : ''}`}
              onClick={() => toggle(ally.id)}
            >
              {portrait(ally.name, ally.portraitSrc)}
              <span className="alert-swap-name">{ally.name}</span>
              {ally.ai && <span className="alert-swap-ai">AI</span>}
              {score(ally.initiative, selected ? me?.initiative : undefined)}
              {eyers && <span className="alert-swap-eyeing">{eyers} eyeing</span>}
            </button>
          );
        })}
      </div>

      <div className="alert-swap-actions">
        <Button variant="ghost" onClick={() => resolve(null)}>Cancel</Button>
        <Button onClick={() => resolve(myPick)}>Confirm</Button>
      </div>
    </aside>
  );
}
