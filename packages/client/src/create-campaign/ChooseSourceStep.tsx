import { useEffect, useState } from 'react';
import type { CompendiumMeta, SavedAdventureMeta } from 'shared';
import { Button } from '../components/Button/Button.tsx';
import Badge from './Badge.tsx';
import InfoTooltip from './InfoTooltip.tsx';
import TypeBadge from './TypeBadge.tsx';
import { truncate } from './textUtils.ts';

const API = `http://${window.location.hostname}:3001`;

export type Choice =
  | { kind: 'type'; type: 'campaign' | 'dungeon-crawl' }
  | { kind: 'module'; module: CompendiumMeta }
  | { kind: 'adventure'; adventure: SavedAdventureMeta };

interface Props {
  title: string;
  selected: Choice | null;
  onChoose: (choice: Choice) => void;
}

export default function ChooseSourceStep({ title, selected, onChoose }: Props) {
  const [modules, setModules] = useState<CompendiumMeta[] | null>(null);
  const [adventures, setAdventures] = useState<SavedAdventureMeta[] | null>(null);

  useEffect(() => {
    fetch(`${API}/api/compendium`)
      .then(r => r.json())
      .then((data: CompendiumMeta[]) => setModules(data.filter(m => m.status === 'complete')))
      .catch(() => setModules([]));
    fetch(`${API}/api/adventures`)
      .then(r => r.json())
      .then((data: SavedAdventureMeta[]) => setAdventures(data))
      .catch(() => setAdventures([]));
  }, []);

  return (
    <div className="create-source">
      <h1 className="modal-title">{title}</h1>
      <section className="create-source-section">
        <h2 className="create-source-section-title create-label-row">
          Start Fresh
          <InfoTooltip text="Generate a brand new world from scratch with AI, based on your own prompts." />
        </h2>
        <div className="create-source-types">
          <Button
            variant="ghost"
            className={`create-source-type-card ${selected?.kind === 'type' && selected.type === 'campaign' ? 'create-source-type-card--selected' : ''}`}
            onClick={() => onChoose({ kind: 'type', type: 'campaign' })}
          >
            <span className="create-source-type-title">New Campaign</span>
            <span className="create-source-type-body">A full world generated from your prompt — grows session to session.</span>
          </Button>
          <Button
            variant="ghost"
            className={`create-source-type-card ${selected?.kind === 'type' && selected.type === 'dungeon-crawl' ? 'create-source-type-card--selected' : ''}`}
            onClick={() => onChoose({ kind: 'type', type: 'dungeon-crawl' })}
          >
            <span className="create-source-type-title">New Dungeon Crawl</span>
            <span className="create-source-type-body">A self-contained dungeon built around your party size.</span>
          </Button>
        </div>
      </section>

      <section className="create-source-section">
        <h2 className="create-source-section-title create-label-row">
          Adventure Modules
          <InfoTooltip text="Pre-written adventures you've uploaded — pick one to generate a ready-to-play campaign from it." />
        </h2>
        {modules === null && <p className="create-source-empty">Loading…</p>}
        {modules !== null && modules.length === 0 && <p className="create-source-empty">No modules uploaded yet.</p>}
        {modules !== null && modules.length > 0 && (
          <ul className="create-source-list">
            {modules.map(m => (
              <li
                key={m.slug}
                className={`create-source-list-item ${selected?.kind === 'module' && selected.module.slug === m.slug ? 'create-source-list-item--selected' : ''}`}
                onClick={() => onChoose({ kind: 'module', module: m })}
              >
                <span className="create-source-list-name">{m.name}</span>
                <span className="create-source-list-arrow">›</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="create-source-section">
        <h2 className="create-source-section-title create-label-row">
          Saved Adventures
          <InfoTooltip text="Templates saved from a previous campaign — spin up a fresh copy with a new party, no regeneration needed." />
        </h2>
        {adventures === null && <p className="create-source-empty">Loading…</p>}
        {adventures !== null && adventures.length === 0 && <p className="create-source-empty">No saved adventures yet.</p>}
        {adventures !== null && adventures.length > 0 && (
          <ul className="create-source-list">
            {adventures.map(a => (
              <li
                key={a.slug}
                className={`create-source-list-item ${selected?.kind === 'adventure' && selected.adventure.slug === a.slug ? 'create-source-list-item--selected' : ''}`}
                onClick={() => onChoose({ kind: 'adventure', adventure: a })}
              >
                <div className="create-source-list-content">
                  <span className="create-source-list-name">{a.name}</span>
                  <div className="create-badge-row">
                    <TypeBadge sourceType={a.sourceType} />
                    {a.partySize !== undefined && <Badge>Party of {a.partySize}</Badge>}
                    {a.theme && <Badge>{a.theme}</Badge>}
                  </div>
                  {a.scenarioSynopsis && (
                    <p className="create-source-list-synopsis">{truncate(a.scenarioSynopsis, 300)}</p>
                  )}
                </div>
                <span className="create-source-list-arrow">›</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
