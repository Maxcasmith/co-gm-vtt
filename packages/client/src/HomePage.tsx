import { useEffect, useRef, useState } from 'react';
import type { Campaign, Character } from 'shared';
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
  const [games, setGames] = useState<Game[] | null>(null);
  const [sessions] = useState<Character[]>(readSessions);

  function fetchCampaigns() {
    fetch(`${API}/api/campaigns`)
      .then(r => r.json())
      .then((campaigns: Campaign[]) => setGames(campaigns.map(campaignToGame)))
      .catch(() => setGames([]));
  }

  useEffect(() => { fetchCampaigns(); }, []);

  function closeModal() { dialogRef.current?.close(); }

  async function tryJoin(gameId: string, pw: string): Promise<boolean> {
    const r = await fetch(`${API}/api/campaigns/${gameId}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const data = await r.json() as { ok?: boolean; error?: string };
    if (!r.ok || data.error) return false;
    window.location.href = `/${gameId}/lobby`;
    return true;
  }

  // A game with no password authenticates on an empty string server-side — try that silently
  // first so a passwordless campaign skips straight to the lobby, and only fall back to the
  // modal when the server actually rejects it (i.e. a password is required).
  async function handleGameClick(game: Game) {
    setSelectedGame(game);
    try {
      if (await tryJoin(game.id, '')) return;
    } catch { /* fall through to the modal — also covers a network error */ }
    setPassword('');
    dialogRef.current?.showModal();
  }

  async function handleJoin() {
    if (!selectedGame) return;
    try {
      if (!(await tryJoin(selectedGame.id, password))) alert('Invalid password');
    } catch {
      alert('Could not connect to server');
    }
  }

  return (
      <div className="home">
        <div className="home-atmosphere" aria-hidden="true" />
        <header className="home-header">
          <div className="home-header-titles">
            <span className="home-eyebrow">The Chronicle Awaits</span>
            <h1 className="home-title">
              <span className="home-title-flourish" aria-hidden="true" />
              Campaigns
              <span className="home-title-flourish" aria-hidden="true" />
            </h1>
            <p className="home-tagline">Choose your table and step back into the story.</p>
          </div>
          <div className="home-header-actions">
            <a className="btn-secondary" href="/admin">Admin</a>
          </div>
        </header>

        {games === null && (
          <ul className="game-list">
            {[0, 1, 2].map(i => (
              <li key={i} className="game-card game-card--skeleton">
                <span className="game-card-sigil skeleton-line skeleton-line--sigil" />
                <div className="game-card-info">
                  <span className="skeleton-line skeleton-line--title" />
                  <span className="skeleton-line skeleton-line--meta" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {games !== null && games.length === 0 && (
          <div className="empty-state">
            <span className="empty-state-icon" aria-hidden="true">🎲</span>
            <p className="empty-state-text">No campaigns yet — ask your GM to create one.</p>
          </div>
        )}

        {games !== null && games.length > 0 && (
          <ul className="game-list">
            {games.map((game, i) => (
              <li key={i} className="game-card" onClick={() => void handleGameClick(game)}>
                <span className="game-card-sigil">{game.name[0]?.toUpperCase()}</span>
                <div className="game-card-info">
                  <span className="game-name">{game.name}</span>
                  <span className="game-meta">{game.system}</span>
                </div>
                <span className="game-arrow">›</span>
              </li>
            ))}
          </ul>
        )}

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
          <div className="modal-header">
            <h2 className="modal-title">{selectedGame?.name}</h2>
          </div>
          <div className="modal-form">
            <label className="modal-label">
              Password
              <input
                className="modal-input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleJoin(); }}
                placeholder="Game password (leave blank if none)"
                autoFocus
              />
            </label>
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={closeModal}>Cancel</button>
            <button className="btn-primary" onClick={() => void handleJoin()}>Enter</button>
          </div>
        </dialog>
      </div>
  );
}
