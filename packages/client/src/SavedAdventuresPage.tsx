import { useEffect, useState } from 'react';
import type { SavedAdventureMeta } from 'shared';
import Badge from './create-campaign/Badge.tsx';
import TypeBadge from './create-campaign/TypeBadge.tsx';
import { truncate } from './create-campaign/textUtils.ts';
import DeleteResourcesModal from './DeleteResourcesModal.tsx';
import './app.css';
import './styles/create-campaign.css';

const API = `http://${window.location.hostname}:3001`;

export default function SavedAdventuresPage() {
  const [adventures, setAdventures] = useState<SavedAdventureMeta[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedAdventureMeta | null>(null);

  function fetchAdventures() {
    fetch(`${API}/api/adventures`)
      .then(r => r.json())
      .then((data: SavedAdventureMeta[]) => setAdventures(data))
      .catch(() => setAdventures([]));
  }

  useEffect(() => { fetchAdventures(); }, []);

  return (
    <div className="home">
      <div className="home-atmosphere" aria-hidden="true" />
      <header className="home-header">
        <div className="home-header-titles">
          <span className="home-eyebrow">The Chronicle Awaits</span>
          <h1 className="home-title">
            <span className="home-title-flourish" aria-hidden="true" />
            My Saved Adventures
            <span className="home-title-flourish" aria-hidden="true" />
          </h1>
          <p className="home-tagline">Reusable templates saved from past campaigns.</p>
        </div>
        <div className="home-header-actions">
          <a className="btn-secondary" href="/">← Back to Game List</a>
        </div>
      </header>

      {adventures === null && (
        <ul className="create-source-list saved-adventures-list">
          {[0, 1].map(i => (
            <li key={i} className="create-source-list-item create-source-list-item--static">
              <div className="create-source-list-content">
                <span className="skeleton-line skeleton-line--title" />
                <span className="skeleton-line skeleton-line--meta" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {adventures !== null && adventures.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon" aria-hidden="true">💾</span>
          <p className="empty-state-text">No saved adventures yet — save a campaign to reuse it without regenerating.</p>
        </div>
      )}

      {adventures !== null && adventures.length > 0 && (
        <ul className="create-source-list saved-adventures-list">
          {adventures.map(a => (
            <li key={a.slug} className="create-source-list-item create-source-list-item--static">
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
              <button className="btn-danger" onClick={() => setDeleteTarget(a)}>Delete</button>
            </li>
          ))}
        </ul>
      )}

      <DeleteResourcesModal
        open={deleteTarget !== null}
        name={deleteTarget?.name ?? ''}
        deleteUrl={`/api/adventures/${deleteTarget?.slug ?? ''}`}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          if (!deleteTarget) return;
          setAdventures(prev => prev?.filter(x => x.slug !== deleteTarget.slug) ?? null);
        }}
      />
    </div>
  );
}
