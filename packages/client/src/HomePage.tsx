import { useEffect, useState } from 'react';
import type { Campaign, Character } from 'shared';
import { useAppMeta } from './AppMetaContext.tsx';
import { Button } from './components/Button/Button.tsx';
import Badge from './create-campaign/Badge.tsx';
import TypeBadge from './create-campaign/TypeBadge.tsx';
import { truncate } from './create-campaign/textUtils.ts';
import HomePageShell from './HomePageShell.tsx';
import './app.css';

interface Game {
  id: string;
  name: string;
  type: Campaign['type'];
  synopsis?: string;
  tags?: string[];
}

const API = `http://${window.location.hostname}:3001`;
const COVER_GRADIENTS = 5;

function campaignToGame(c: Campaign): Game {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    synopsis: c.scenarioSynopsis ?? c.concept?.description,
    tags: c.tags,
  };
}

function coverGradientClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return `game-card-cover--g${Math.abs(hash) % COVER_GRADIENTS}`;
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
  const { platform } = useAppMeta();
  const [games, setGames] = useState<Game[] | null>(null);
  const [sessions] = useState<Character[]>(readSessions);
  const [coverErrors, setCoverErrors] = useState<Set<string>>(new Set());

  function fetchCampaigns() {
    fetch(`${API}/api/campaigns`)
      .then(r => r.json())
      .then((campaigns: Campaign[]) => setGames(campaigns.map(campaignToGame)))
      .catch(() => setGames([]));
  }

  useEffect(() => { fetchCampaigns(); }, []);

  return (
      <HomePageShell
        eyebrow="The Chronicle Awaits"
        title="Campaigns"
        tagline="Choose your table and step back into the story."
        actions={platform === 'desktop' && <Button variant="outline" color="secondary" navigate="/admin">Admin</Button>}
      >
        <div className="home-create-cta">
          <Button navigate="/create">+ Create New Game</Button>
          <Button variant="outline" color="secondary" navigate="/saved-adventures">My Saved Adventures</Button>
        </div>

        {games === null && (
          <ul className="game-grid">
            {[0, 1, 2].map(i => (
              <li key={i} className="game-card game-card--skeleton">
                <span className="game-card-cover skeleton-line skeleton-line--cover" />
                <div className="game-card-body">
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
          <ul className="game-grid">
            {games.map(game => (
              <li key={game.id} className="game-card">
                <a className="game-card-link" href={`/${game.id}/lobby`}>
                  {coverErrors.has(game.id) ? (
                    <div className={`game-card-cover game-card-cover--fallback ${coverGradientClass(game.id)}`}>
                      {game.name[0]?.toUpperCase()}
                    </div>
                  ) : (
                    <img
                      className="game-card-cover"
                      src={`${API}/api/campaigns/${game.id}/world-map`}
                      alt=""
                      onError={() => setCoverErrors(prev => new Set(prev).add(game.id))}
                    />
                  )}
                  <div className="game-card-body">
                    <div className="game-card-header">
                      <span className="game-name">{game.name}</span>
                      <TypeBadge sourceType={game.type} />
                    </div>
                    {game.synopsis && <p className="game-card-synopsis">{truncate(game.synopsis, 120)}</p>}
                    {game.tags && game.tags.length > 0 && (
                      <div className="create-badge-row game-card-tags">
                        {game.tags.slice(0, 4).map(tag => <Badge key={tag}>{tag}</Badge>)}
                      </div>
                    )}
                  </div>
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
      </HomePageShell>
  );
}
