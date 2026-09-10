import { useEffect, useState } from 'react';
import type { Campaign } from 'shared';
import { GridIcon, ListIcon, PlayIcon, SearchIcon } from '../../components/icons/Icons';
import { ParchmentLayout } from '../../components/ParchmentLayout/ParchmentLayout';
import { SignedInHeader } from '../../components/SignedInHeader/SignedInHeader';
import { CLIENT_URL } from '../../createCampaignHandoff';
import api from '../../api/client';
import './GameListings.css';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface PartyMember {
  id: string;
  name: string;
}

interface GameDetail {
  description: string;
  synopsis: string;
  tags: string[];
  type?: string;
  partySize?: number;
  party: PartyMember[];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function typeLabel(type?: string): string {
  switch (type) {
    case 'dungeon-crawl': return 'Dungeon';
    case 'campaign': return 'Campaign';
    case 'module': return 'Module';
    case 'one-shot': return 'One-Shot';
    default: return '';
  }
}

// The list endpoint only returns {id, name} — description/synopsis/tags/badges/party each live
// behind their own per-campaign route, so fetch them alongside the list rather than bloating it.
async function fetchDetail(id: string): Promise<GameDetail> {
  const [detail, party] = await Promise.all([
    api.get(`campaigns/${id}`).catch(() => ({})),
    api.get(`campaigns/${id}/party`).catch(() => []),
  ]);

  return {
    description: detail?.concept?.description ?? '',
    synopsis: detail?.scenarioSynopsis ?? '',
    tags: detail?.tags ?? [],
    type: detail?.type,
    partySize: detail?.partySize,
    party: (party ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })),
  };
}

function PartyAvatar({ gameId, member }: { gameId: string; member: PartyMember }) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return <span className="game-card--avatar" title={member.name}>{initials(member.name)}</span>;
  }

  return (
    <img
      className="game-card--avatar game-card--avatar--img"
      src={`${API_BASE}/api/campaigns/${gameId}/party/${member.id}/portrait`}
      alt={member.name}
      title={member.name}
      onError={() => setImgFailed(true)}
    />
  );
}

export function GameListings() {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [games, setGames] = useState<Campaign[] | null>(null);
  const [details, setDetails] = useState<Record<string, GameDetail>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('campaigns').then(async (list: Campaign[]) => {
      setGames(list);
      const entries = await Promise.all(list.map(async g => [g.id, await fetchDetail(g.id)] as const));
      setDetails(Object.fromEntries(entries));
    }).catch(() => setGames([]));
  }, []);

  const visible = (games ?? []).filter(g => g.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <ParchmentLayout
      header={<SignedInHeader />}
      skeleton={
        <div className="listings--body parchment-container">
          <main className="listings--main">
            <div className="listings--main--header">
              <div>
                <span className="skeleton listings--skeleton--title" />
                <span className="skeleton listings--skeleton--subtitle" />
              </div>
              <span className="skeleton listings--skeleton--cta" />
            </div>

            <div className="listings--controls">
              <span className="skeleton listings--skeleton--search" />
              <span className="skeleton listings--skeleton--toggle" />
            </div>

            <div className="listings--grid listings--grid--grid">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <article className="game-card" key={i}>
                  <span className="skeleton game-card--cover" />
                  <div className="game-card--body">
                    <span className="skeleton listings--skeleton--card-title" />
                    <span className="skeleton listings--skeleton--card-line" />
                  </div>
                </article>
              ))}
            </div>
          </main>
        </div>
      }
    >
      <div className="listings--body parchment-container">
        <main className="listings--main">
          <div className="listings--main--header">
            <div>
              <h1 className="listings--title">My Games</h1>
              <p className="listings--subtitle">All the worlds you've created and the stories you run.</p>
            </div>
            <a className="btn btn--fill btn--primary btn--md" href={`${CLIENT_URL}/create`}>+ Create New Game</a>
          </div>

          <div className="listings--controls">
            <div className="listings--search">
              <SearchIcon className="listings--search-icon" />
              <input type="text" placeholder="Search games…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="listings--view-toggle">
              <button
                type="button"
                aria-label="Grid view"
                className={view === 'grid' ? 'is-active' : ''}
                onClick={() => setView('grid')}
              >
                <GridIcon className="listings--view-toggle-icon" />
              </button>
              <button
                type="button"
                aria-label="List view"
                className={view === 'list' ? 'is-active' : ''}
                onClick={() => setView('list')}
              >
                <ListIcon className="listings--view-toggle-icon" />
              </button>
            </div>
          </div>

          {games !== null && games.length === 0 && (
            <p className="listings--empty">No games yet — start one from the Play button above.</p>
          )}

          <div className={`listings--grid listings--grid--${view}`}>
            {visible.map(game => {
              const detail = details[game.id];
              const badgeLabel = typeLabel(detail?.type);
              return (
                <article className="game-card" key={game.id}>
                  <div className="game-card--cover" />
                  <div className="game-card--body">
                    <h3 className="game-card--title">{game.name}</h3>

                    {(badgeLabel || detail?.partySize !== undefined) && (
                      <div className="game-card--badges">
                        {badgeLabel && <span className="game-card--badge">{badgeLabel}</span>}
                        {detail?.partySize !== undefined && (
                          <span className="game-card--badge">Party of {detail.partySize}</span>
                        )}
                      </div>
                    )}

                    {detail?.description && <p className="game-card--description">{detail.description}</p>}
                    {detail?.synopsis && <p className="game-card--synopsis">{detail.synopsis}</p>}

                    {!!detail?.tags.length && (
                      <div className="game-card--tags">
                        {detail.tags.map(tag => (
                          <span className="game-card--tag" key={tag}>{tag}</span>
                        ))}
                      </div>
                    )}

                    {!!detail?.party.length && (
                      <div className="game-card--avatars">
                        {detail.party.map(member => (
                          <PartyAvatar key={member.id} gameId={game.id} member={member} />
                        ))}
                      </div>
                    )}

                    <a className="btn btn--fill btn--primary btn--md game-card--play" href={`${CLIENT_URL}/${game.id}/lobby`}>
                      <PlayIcon className="game-card--play-icon" /> Play
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        </main>
      </div>
    </ParchmentLayout>
  );
}
