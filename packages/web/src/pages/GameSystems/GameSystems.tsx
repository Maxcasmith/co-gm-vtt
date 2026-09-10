import { CheckIcon, D20Icon } from '../../components/icons/Icons';
import { ParchmentLayout } from '../../components/ParchmentLayout/ParchmentLayout';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { GAME_SYSTEMS, UPCOMING_GAME_SYSTEMS } from '../../data/gameSystems';
import './GameSystems.css';

export function GameSystems() {
  return (
    <ParchmentLayout
      header={<PageHeader />}
      skeleton={
        <>
          <div className="systems--intro parchment-container">
            <span className="skeleton systems--skeleton--title" />
            <span className="skeleton systems--skeleton--subtitle" />
          </div>
          <div className="systems--grid parchment-container">
            {[0, 1].map(i => (
              <section className="systems--card" key={i}>
                <span className="skeleton systems--skeleton--icon" />
                <span className="skeleton systems--skeleton--card-title" />
                <span className="skeleton systems--skeleton--tagline" />
                <div className="systems--card--features">
                  {[0, 1, 2, 3].map(j => (
                    <span className="skeleton systems--skeleton--feature" key={j} />
                  ))}
                </div>
              </section>
            ))}
          </div>
          <div className="systems--upcoming parchment-container">
            <span className="skeleton systems--skeleton--card-title" />
            <div className="systems--upcoming--list">
              {[0, 1, 2, 3].map(i => (
                <div className="systems--upcoming--tile" key={i}>
                  <span className="skeleton systems--skeleton--upcoming-name" />
                  <span className="skeleton systems--skeleton--upcoming-desc" />
                  <span className="skeleton systems--skeleton--upcoming-badge" />
                </div>
              ))}
            </div>
          </div>
        </>
      }
    >
      <div className="systems--intro parchment-container">
        <h1 className="systems--intro--title">Supported Game Systems</h1>
        <p className="systems--intro--subtitle">
          Every campaign runs on a real ruleset, adjudicated by an AI Dungeon Master. Here's what's live today.
        </p>
      </div>

      <div className="systems--grid parchment-container">
        {GAME_SYSTEMS.map(system => (
          <section className="systems--card" key={system.id}>
            <div className="systems--card--header">
              <D20Icon className="systems--card--icon" />
              <span className={`systems--card--badge systems--card--badge--${system.status}`}>
                {system.status === 'supported' ? 'Supported' : 'Coming Soon'}
              </span>
            </div>
            <h2 className="systems--card--title">{system.name}</h2>
            <p className="systems--card--edition">{system.edition}</p>
            <p className="systems--card--description">{system.description}</p>
            <ul className="systems--card--features">
              {system.features.map(f => (
                <li key={f}><CheckIcon className="systems--card--check" /> {f}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="systems--upcoming parchment-container">
        <h2 className="systems--upcoming--title">Upcoming Support</h2>
        <div className="systems--upcoming--list">
          {UPCOMING_GAME_SYSTEMS.map(system => (
            <div className="systems--upcoming--tile" key={system.name}>
              <span className="systems--upcoming--tile-name">{system.name}</span>
              <p className="systems--upcoming--tile-desc">{system.description}</p>
              <span className="systems--card--badge systems--card--badge--not-supported">Not Supported</span>
            </div>
          ))}
        </div>
      </div>
    </ParchmentLayout>
  );
}
