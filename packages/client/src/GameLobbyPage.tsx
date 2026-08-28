import { useEffect, useState } from 'react';
import type { Character } from 'shared';
import './app.css';

interface Props { campaignId: string }

const API = `http://${window.location.hostname}:3001`;

export default function GameLobbyPage({ campaignId }: Props) {
  const [campaignName, setCampaignName] = useState('');
  // Dungeon-crawl worlds only — the rich scenario synopsis written before the dungeon itself (see
  // routes/campaigns.ts's dungeon-crawl branch). Absent for every other world type.
  const [synopsis, setSynopsis] = useState('');
  const [party, setParty] = useState<Character[]>([]);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/campaigns/${campaignId}`)
      .then(r => r.json())
      .then((c: { name?: string; scenarioSynopsis?: string }) => {
        setCampaignName(c.name ?? campaignId);
        setSynopsis(c.scenarioSynopsis ?? '');
      })
      .catch(() => setCampaignName(campaignId));
    fetch(`${API}/api/campaigns/${campaignId}/party`)
      .then(r => r.json())
      .then((chars: Character[]) => setParty(chars))
      .catch(() => {});

    const store = JSON.parse(localStorage.getItem('vtt-passwords') ?? '{}') as Record<string, string>;
    const saved = Object.entries(store).find(([k]) => k.startsWith(`${campaignId}:`));
    if (saved) setPassword(saved[1]);
  }, [campaignId]);

  async function handleJoin() {
    if (!password || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/campaigns/${campaignId}/party/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await r.json() as Character & { error?: string };
      if (!r.ok || data.error) { alert(data.error ?? 'Invalid password'); return; }
      sessionStorage.setItem(`vtt-session:${campaignId}`, JSON.stringify(data));
      window.location.href = `/${campaignId}/game`;
    } catch {
      alert('Could not connect to server');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="home">
      <div className="home-atmosphere" aria-hidden="true" />
      <div className="game-settings-page">
        <div className="settings-sidebar-header">
          <a className="btn-secondary" href="/">&larr; Back</a>
          <h2 className="settings-title">{campaignName}</h2>
        </div>

        <div className="settings-body">
          {synopsis && <p className="lobby-synopsis">{synopsis}</p>}
          {party.length === 0 && (
            <p className="party-empty">There are currently no adventurers in the party.</p>
          )}
          {party.length > 0 && (
            <ul className="party-list">
              {party.map(char => (
                <li key={char.id} className="party-list-item">
                  <div className="party-list-portrait">
                    {char.portraitPath
                      ? <img src={`${API}/api/campaigns/${char.campaignId}/party/${char.id}/portrait`} alt={char.name} />
                      : <span>{char.name[0]?.toUpperCase()}</span>
                    }
                  </div>
                  <span className="party-list-name">{char.name}</span>
                  {char.class && <span className="party-list-meta">{char.species} {char.class}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="modal-form">
            <label className="modal-label">
              Character Password
              <input
                className="modal-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleJoin(); }}
                placeholder="Your character password"
              />
            </label>
          </div>
        </div>

        <div className="modal-actions modal-actions--split settings-footer">
          <a className="btn-create-player-link" href={`/${campaignId}/player/create`}>
            New here? Create a character
          </a>
          <div className="modal-action-btns">
            <a className="btn-secondary" href={`/${campaignId}/game-settings`}>Game Settings</a>
            <button className="btn-primary" onClick={() => void handleJoin()} disabled={!password || loading}>Join</button>
          </div>
        </div>
      </div>
    </div>
  );
}
