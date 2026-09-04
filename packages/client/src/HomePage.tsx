import { useEffect, useState } from 'react';
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
  const [games, setGames] = useState<Game[] | null>(null);
  const [sessions] = useState<Character[]>(readSessions);

  function fetchCampaigns() {
    fetch(`${API}/api/campaigns`)
      .then(r => r.json())
      .then((campaigns: Campaign[]) => setGames(campaigns.map(campaignToGame)))
      .catch(() => setGames([]));
  }

  useEffect(() => { fetchCampaigns(); }, []);

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
            <a className="btn-secondary" href="/saved-adventures">My Saved Adventures</a>
            <a className="btn-secondary" href="/admin">Admin</a>
          </div>
        </header>

        <div className="home-create-cta">
          <a className="btn-primary" href="/create">+ Create New Game</a>
        </div>

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
              <li key={i} className="game-card">
                <a className="game-card-link" href={`/${game.id}/lobby`}>
                  <span className="game-card-sigil">{game.name[0]?.toUpperCase()}</span>
                  <div className="game-card-info">
                    <span className="game-name">{game.name}</span>
                    <span className="game-meta">{game.system}</span>
                  </div>
                  <span className="game-arrow">›</span>
                </a>
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
      </div>
  );
}
