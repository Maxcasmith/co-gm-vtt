import { useEffect, useRef, useState } from 'react';
import type { Campaign, Character } from 'shared';
import CreateCampaignModal from './CreateCampaignModal.tsx';
import './app.css';

interface Game {
  id: string;
  name: string;
  system: string;
}

const API = `http://${window.location.hostname}:3001`;

function campaignToGame(c: Campaign): Game {
  return { id: c.id, name: c.name, system: 'Custom' };
}

function readSessions(): Character[] {
  const out: Character[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (!key?.startsWith('vtt-session:')) continue;
    try { out.push(JSON.parse(sessionStorage.getItem(key) ?? '') as Character); } catch { /* skip */ }
  }
  return out;
}

export default function HomePage() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [password, setPassword] = useState('');
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [games, setGames] = useState<Game[] | null>(null);
  const [sessions] = useState<Character[]>(readSessions);
  const [party, setParty] = useState<Character[]>([]);

  function fetchCampaigns() {
    fetch(`${API}/api/campaigns`)
      .then(r => r.json())
      .then((campaigns: Campaign[]) => setGames(campaigns.map(campaignToGame)))
      .catch(() => setGames([]));
  }

  useEffect(() => { fetchCampaigns(); }, []);

  function openModal(game: Game) {
    setSelectedGame(game);
    setParty([]);
    const store = JSON.parse(localStorage.getItem('vtt-passwords') ?? '{}') as Record<string, string>;
    const saved = Object.entries(store).find(([k]) => k.startsWith(`${game.id}:`));
    setPassword(saved?.[1] ?? '');
    fetch(`${API}/api/campaigns/${game.id}/party`)
      .then(r => r.json())
      .then((chars: Character[]) => setParty(chars))
      .catch(() => {});
    dialogRef.current?.showModal();
  }

  function closeModal() { dialogRef.current?.close(); }

  async function handleJoin() {
    if (!selectedGame || !password) return;
    try {
      const r = await fetch(`${API}/api/campaigns/${selectedGame.id}/party/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await r.json() as Character & { error?: string };
      if (!r.ok || data.error) { alert(data.error ?? 'Invalid password'); return; }
      sessionStorage.setItem(`vtt-session:${selectedGame.id}`, JSON.stringify(data));
      window.location.href = `/${selectedGame.id}/game`;
    } catch {
      alert('Could not connect to server');
    }
  }

  return (
    <>
      <div className="home">
        <header className="home-header">
          <h1 className="home-title">Games</h1>
          <div className="home-header-actions">
            <a className="btn-secondary" href="/admin">Admin</a>
          </div>
        </header>

        {games === null && (
          <ul className="game-list">
            {[0, 1, 2].map(i => (
              <li key={i} className="game-card game-card--skeleton">
                <div className="game-card-info">
                  <span className="skeleton-line skeleton-line--title" />
                  <span className="skeleton-line skeleton-line--meta" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {games !== null && games.length === 0 && (
          <p className="empty-state">No campaigns yet — ask your GM to create one.</p>
        )}

        {games !== null && games.length > 0 && (
          <ul className="game-list">
            {games.map((game, i) => (
              <li key={i} className="game-card" onClick={() => openModal(game)}>
                <div className="game-card-info">
                  <span className="game-name">{game.name}</span>
                  <span className="game-meta">{game.system}</span>
                </div>
                <span className="game-arrow">›</span>
              </li>
            ))}
          </ul>
        )}

        <button className="btn-create-campaign" onClick={() => setCampaignOpen(true)}>
          + Create Campaign
        </button>

        {sessions.length > 0 && (
          <section className="continue-section">
            <h2 className="continue-title">Continue as</h2>
            <div className="continue-row">
              {sessions.map(char => {
                const campaignName = games?.find(g => g.id === char.campaignId)?.name ?? char.campaignId;
                const portraitCharId = char.portraitPath
                  ? char.portraitPath.split('/')[1] ?? char.id
                  : char.id;
                return (
                  <a key={char.id} className="continue-card" href={`/${char.campaignId}/game`}>
                    <div className="continue-portrait">
                      {char.portraitPath
                        ? <img
                            src={`${API}/api/campaigns/${char.campaignId}/party/${portraitCharId}/portrait`}
                            className="continue-portrait-img"
                            alt={char.name}
                          />
                        : <span className="continue-portrait-initial">{char.name[0]?.toUpperCase()}</span>
                      }
                    </div>
                    <span className="continue-name">{char.name}</span>
                    <span className="continue-campaign">{campaignName}</span>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        <dialog ref={dialogRef} className="modal">
          <h2 className="modal-title">{selectedGame?.name}</h2>
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
                  {char.class && <span className="party-list-meta">{char.race} {char.class}</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="modal-form">
            <label className="modal-label">
              Password
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
          <div className="modal-actions modal-actions--split">
            <a
              className="btn-create-player-link"
              href={selectedGame ? `/${selectedGame.id}/player/create` : '#'}
            >
              New here? Create a character
            </a>
            <div className="modal-action-btns">
              <button className="btn-secondary" onClick={closeModal}>Cancel</button>
              <button className="btn-primary" onClick={() => void handleJoin()} disabled={!password}>Join</button>
            </div>
          </div>
        </dialog>
      </div>

      <CreateCampaignModal
        open={campaignOpen}
        onClose={() => setCampaignOpen(false)}
        onCreated={fetchCampaigns}
      />
    </>
  );
}
