import { useEffect, useState } from 'react';
import GenerateTilesetModal from './GenerateTilesetModal.tsx';
import BestiaryTab from './BestiaryTab.tsx';

const API = `http://${window.location.hostname}:3001`;

type TilesetManifest = Record<string, Record<string, string[]>>;
type ResourceTab = 'tiles' | 'bestiary';

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function AdminResourcesPage() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed]     = useState(false);
  const [error, setError]       = useState('');
  const [tab, setTab]           = useState<ResourceTab>('tiles');
  const [manifest, setManifest] = useState<TilesetManifest>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [generateOpen, setGenerateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  function fetchManifest() {
    fetch(`${API}/api/tilesets/manifest`)
      .then(r => r.json())
      .then((data: TilesetManifest) => setManifest(data))
      .catch(() => {});
  }

  useEffect(() => { if (authed) fetchManifest(); }, [authed]);

  async function handleAuth() {
    const r = await fetch(`${API}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (r.ok && (await r.json() as { ok: boolean }).ok) setAuthed(true);
    else setError('Invalid password');
  }

  function toggle(theme: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(theme)) next.delete(theme); else next.add(theme);
      return next;
    });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`${API}/api/admin/tilesets/${deleteTarget}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': password },
      });
      if (r.ok) {
        setManifest(m => { const n = { ...m }; delete n[deleteTarget]; return n; });
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  if (!authed) {
    return (
      <div className="admin-gate">
        <div className="admin-gate-card">
          <span className="admin-gate-icon" aria-hidden="true">🔒</span>
          <span className="home-eyebrow">Restricted Chamber</span>
          <h1 className="admin-title">Dungeon Master&apos;s Study</h1>
          <p className="admin-gate-sub">Speak the password to enter.</p>
          {error && <p className="admin-error">{error}</p>}
          <input
            className="modal-input admin-pw-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAuth()}
            autoFocus
          />
          <button className="btn-primary" onClick={handleAuth}>Enter</button>
          <a className="admin-gate-back" href="/admin">← Back to Admin</a>
        </div>
      </div>
    );
  }

  const themes = Object.entries(manifest);

  return (
    <>
      <div className="admin-panel">
        <div className="admin-atmosphere" aria-hidden="true" />
        <div className="admin-header">
          <a className="btn-secondary admin-header-link admin-header-link--left" href="/admin">← Admin</a>
          <div className="admin-header-titles">
            <span className="home-eyebrow">Dungeon Master&apos;s Study</span>
            <h1 className="admin-title">
              <span className="home-title-flourish" aria-hidden="true" />
              Resources
              <span className="home-title-flourish" aria-hidden="true" />
            </h1>
          </div>
        </div>

        <div className="sheet-tabs admin-resource-tabs">
          <button className={`sheet-tab${tab === 'tiles' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('tiles')}>Tiles</button>
          <button className={`sheet-tab${tab === 'bestiary' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('bestiary')}>Bestiary</button>
        </div>

        {tab === 'bestiary' && <BestiaryTab />}

        {tab === 'tiles' && <>
        <div className="admin-modules-header">
          <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">🧱</span>Dungeon Tilesets</h2>
          <button className="btn-primary" onClick={() => setGenerateOpen(true)}>+ Generate Tileset</button>
        </div>

        {themes.length === 0 && (
          <div className="admin-table-card"><p className="admin-empty">No tilesets generated yet.</p></div>
        )}

        <div className="tiles-accordion">
          {themes.map(([theme, allMaterials]) => {
            const { source, source_extended: sourceExtended, ...materials } = allMaterials;
            const isOpen = expanded.has(theme);
            const tileCount = Object.values(materials).reduce((sum, urls) => sum + urls.length, 0);
            return (
              <div key={theme} className="tiles-accordion-item">
                <div className="tiles-accordion-header">
                  <button className="tiles-accordion-toggle" onClick={() => toggle(theme)} aria-expanded={isOpen}>
                    <span className="tiles-accordion-caret">{isOpen ? '▾' : '▸'}</span>
                    <span className="tiles-accordion-name">{titleCase(theme)}</span>
                    <span className="admin-module-counts">{tileCount} tiles</span>
                  </button>
                  <button className="btn-danger tiles-accordion-delete" onClick={() => setDeleteTarget(theme)}>Delete</button>
                </div>
                {isOpen && (
                  <div className="tiles-accordion-body">
                    {source?.[0] && (
                      <div className="tile-source">
                        <img
                          src={`${API}${source[0]}`}
                          alt={`Source atlas — ${titleCase(theme)}`}
                          title={`Source atlas — ${titleCase(theme)}`}
                          className="tile-source-img"
                        />
                        <span className="tile-label">Source Atlas (unmodified AI output)</span>
                      </div>
                    )}
                    {sourceExtended?.[0] && (
                      <div className="tile-source">
                        <img
                          src={`${API}${sourceExtended[0]}`}
                          alt={`Source atlas (extended) — ${titleCase(theme)}`}
                          title={`Source atlas (extended) — ${titleCase(theme)}`}
                          className="tile-source-img"
                        />
                        <span className="tile-label">Source Atlas — Extended (unmodified AI output)</span>
                      </div>
                    )}
                    <div className="tile-grid">
                      {Object.entries(materials).map(([material, urls]) => urls.map(url => (
                        <div key={url} className="tile-card">
                          <img
                            src={`${API}${url}`}
                            alt={`${titleCase(material)} — ${titleCase(theme)}`}
                            title={`${titleCase(material)} — ${titleCase(theme)}`}
                            className="tile-img"
                          />
                          <span className="tile-label">{titleCase(material)}</span>
                        </div>
                      )))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>}
      </div>

      <GenerateTilesetModal
        open={generateOpen}
        password={password}
        onClose={() => setGenerateOpen(false)}
        onGenerated={fetchManifest}
      />

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => !deleting && setDeleteTarget(null)}>
          <dialog className="modal" open onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Delete Tileset</h2>
              <p className="modal-hint">
                Permanently delete the <strong>{titleCase(deleteTarget)}</strong> tileset? This removes all its tiles and the source atlas. This cannot be undone.
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</button>
              <button className="btn-danger" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </dialog>
        </div>
      )}
    </>
  );
}
