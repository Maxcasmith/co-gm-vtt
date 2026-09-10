import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import {
  ChevronDownIcon,
  ClockIcon,
  GridIcon,
  KebabIcon,
  ListIcon,
  PlayIcon,
  SearchIcon,
  UsersIcon,
} from '../../components/icons/Icons';
import { ParchmentLayout } from '../../components/ParchmentLayout/ParchmentLayout';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import './GameListings.css';

interface Game {
  id: string;
  title: string;
  description: string;
  tags: string[];
  sessions: number;
  players: number;
  lastPlayed: string;
  cover: string;
}

const GAMES: Game[] = [
  {
    id: 'drowned-crown',
    title: 'The Drowned Crown',
    description: 'A haunted coastal town cursed by an ancient sea god.',
    tags: ['Dark Fantasy', 'Political', 'Horror'],
    sessions: 5,
    players: 4,
    lastPlayed: 'May 18, 2024',
    cover: 'game-cover--drowned-crown',
  },
  {
    id: 'jadewild',
    title: 'Whispers in the Jadewild',
    description: 'A hidden elven enclave threatened by a spreading corruption.',
    tags: ['High Fantasy', 'Mystery', 'Exploration'],
    sessions: 2,
    players: 3,
    lastPlayed: 'May 12, 2024',
    cover: 'game-cover--jadewild',
  },
  {
    id: 'bloodbound-bastion',
    title: 'The Bloodbound Bastion',
    description: "A warlord's fortress where slavery fuels dark magic.",
    tags: ['Dark Fantasy', 'Combat Heavy', 'Grim'],
    sessions: 7,
    players: 5,
    lastPlayed: 'May 8, 2024',
    cover: 'game-cover--bloodbound-bastion',
  },
  {
    id: 'frostbite-reach',
    title: 'Frostbite Reach',
    description: 'Survive the endless winter and uncover ancient secrets.',
    tags: ['Survival', 'Exploration', 'Mystery'],
    sessions: 1,
    players: 2,
    lastPlayed: 'Apr 30, 2024',
    cover: 'game-cover--frostbite-reach',
  },
  {
    id: 'shifting-sands',
    title: 'The Shifting Sands',
    description: 'Lost tombs, ancient powers, and a kingdom on the brink.',
    tags: ['Ancient', 'Intrigue', 'Dungeon Crawl'],
    sessions: 4,
    players: 4,
    lastPlayed: 'Apr 16, 2024',
    cover: 'game-cover--shifting-sands',
  },
  {
    id: 'black-hollow',
    title: 'The Black Hollow',
    description: 'A quiet village with a terrible secret.',
    tags: ['Gothic Horror', 'Investigation', 'Roleplay'],
    sessions: 3,
    players: 4,
    lastPlayed: 'Mar 28, 2024',
    cover: 'game-cover--black-hollow',
  },
];

export function GameListings() {
  const navigate = useNavigate();
  const [view, setView] = useState<'grid' | 'list'>('grid');

  return (
    <ParchmentLayout
      header={
        <PageHeader
          actions={
            <>
              <Link className="btn btn--outline btn--primary btn--md" to="/login">Log In</Link>
              <Button onClick={() => navigate('/signup')}>Get Started</Button>
            </>
          }
        />
      }
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
              <span className="skeleton listings--skeleton--sort" />
              <span className="skeleton listings--skeleton--toggle" />
            </div>

            <div className="listings--grid listings--grid--grid">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <article className="game-card" key={i}>
                  <span className="skeleton game-card--cover" />
                  <div className="game-card--body">
                    <span className="skeleton listings--skeleton--card-title" />
                    <span className="skeleton listings--skeleton--card-line" />
                    <span className="skeleton listings--skeleton--card-line listings--skeleton--card-line--short" />
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
            <Button>+ Create New Game</Button>
          </div>

          <div className="listings--controls">
            <div className="listings--search">
              <SearchIcon className="listings--search-icon" />
              <input type="text" placeholder="Search games…" />
            </div>
            <label className="listings--sort">
              <select defaultValue="last-played">
                <option value="last-played">Last Played</option>
                <option value="name">Name</option>
              </select>
              <ChevronDownIcon className="listings--sort-icon" />
            </label>
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

          <div className={`listings--grid listings--grid--${view}`}>
            {GAMES.map(game => (
              <article className="game-card" key={game.id}>
                <div className={`game-card--cover ${game.cover}`} />
                <div className="game-card--body">
                  <h3 className="game-card--title">{game.title}</h3>
                  <p className="game-card--description">{game.description}</p>
                  <div className="game-card--tags">
                    {game.tags.map(tag => (
                      <span className="game-card--tag" key={tag}>{tag}</span>
                    ))}
                  </div>
                  <div className="game-card--meta">
                    <span><ClockIcon className="game-card--meta-icon" /> {game.sessions} session{game.sessions === 1 ? '' : 's'}</span>
                    <span><UsersIcon className="game-card--meta-icon" /> {game.players} players</span>
                  </div>
                  <p className="game-card--last-played">Last played {game.lastPlayed}</p>
                  <div className="game-card--footer">
                    <div className="game-card--avatars">
                      {Array.from({ length: Math.min(game.players, 4) }).map((_, i) => (
                        <span className="game-card--avatar" key={i} />
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      className="listings--icon-btn"
                      leftIcon={<KebabIcon className="listings--icon-btn-icon" />}
                      aria-label="More options"
                    />
                  </div>
                  <Link className="btn btn--fill btn--primary btn--md game-card--play" to="#">
                    <PlayIcon className="game-card--play-icon" /> Play
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </main>
      </div>
    </ParchmentLayout>
  );
}
