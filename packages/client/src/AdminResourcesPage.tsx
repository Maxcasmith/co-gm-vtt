import { useEffect, useState } from 'react';
import type { StoryboardTestRecord, StoryboardQueuePayload } from 'shared';
import GenerateTilesetModal from './GenerateTilesetModal.tsx';
import GeneratePropsSidebar from './GeneratePropsSidebar.tsx';
import PreviewCellsModal from './PreviewCellsModal.tsx';
import BestiaryTab from './BestiaryTab.tsx';
import StoryboardTestModal from './StoryboardTestModal.tsx';
import StoryboardOverlay from './StoryboardOverlay.tsx';

const API = `http://${window.location.hostname}:3001`;

type TilesetManifest = Record<string, Record<string, string[]>>;
type PropsManifest = { props: Record<string, string>; sources: string[] };
type ResourceTab = 'tiles' | 'props' | 'bestiary' | 'storyboard';

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface AdminResourcesPageProps {
  password: string;
  onBack: () => void;
}

export default function AdminResourcesPage({ password, onBack }: AdminResourcesPageProps) {
  const [tab, setTab]           = useState<ResourceTab>('tiles');
  const [manifest, setManifest] = useState<TilesetManifest>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [generateOpen, setGenerateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [propsManifest, setPropsManifest] = useState<PropsManifest>({ props: {}, sources: [] });
  const [generatePropsOpen, setGeneratePropsOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [storyboardRecord, setStoryboardRecord] = useState<StoryboardTestRecord | null>(null);
  const [storyboardTestOpen, setStoryboardTestOpen] = useState(false);
  const [storyboardPlaying, setStoryboardPlaying] = useState(false);
  const [storyboardEraseConfirm, setStoryboardEraseConfirm] = useState(false);
  const [storyboardErasing, setStoryboardErasing] = useState(false);

  function fetchStoryboardRecord() {
    fetch(`${API}/api/admin/storyboard-test`, { headers: { 'x-admin-password': password } })
      .then(r => r.json())
      .then((data: { record: StoryboardTestRecord | null }) => setStoryboardRecord(data.record))
      .catch(() => {});
  }

  function fetchManifest() {
    fetch(`${API}/api/tilesets/manifest`)
      .then(r => r.json())
      .then((data: TilesetManifest) => setManifest(data))
      .catch(() => {});
  }

  function fetchPropsManifest() {
    fetch(`${API}/api/props/manifest`)
      .then(r => r.json())
      .then((data: PropsManifest) => setPropsManifest(data))
      .catch(() => {});
  }

  useEffect(() => { fetchManifest(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPropsManifest(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchStoryboardRecord(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function confirmEraseStoryboard() {
    setStoryboardErasing(true);
    try {
      const r = await fetch(`${API}/api/admin/storyboard-test`, {
        method: 'DELETE',
        headers: { 'x-admin-password': password },
      });
      if (r.ok) {
        setStoryboardRecord(null);
        setStoryboardEraseConfirm(false);
      }
    } finally {
      setStoryboardErasing(false);
    }
  }

  const themes = Object.entries(manifest);

  return (
    <>
      <div className="admin-panel">
        <div className="admin-atmosphere" aria-hidden="true" />
        <div className="admin-header">
          <button className="btn-secondary admin-header-link admin-header-link--left" onClick={onBack}>← Admin</button>
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
          <button className={`sheet-tab${tab === 'props' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('props')}>Props</button>
          <button className={`sheet-tab${tab === 'bestiary' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('bestiary')}>Bestiary</button>
          <button className={`sheet-tab${tab === 'storyboard' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('storyboard')}>Storyboard</button>
        </div>

        {tab === 'bestiary' && <BestiaryTab />}

        {tab === 'storyboard' && <>
        <div className="admin-modules-header">
          <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">🎬</span>Character Storyboard</h2>
          <button className="btn-primary" onClick={() => setStoryboardTestOpen(true)}>+ Test Storyboard</button>
        </div>

        {!storyboardRecord && (
          <div className="admin-table-card"><p className="admin-empty">No storyboard generated yet.</p></div>
        )}

        {storyboardRecord && (
          <div className="admin-table-card">
            <div className="admin-modules-header">
              <h3 className="tiles-accordion-name">{storyboardRecord.name}</h3>
              <div className="admin-modules-header-actions">
                <button className="btn-play" onClick={() => setStoryboardPlaying(true)}>▶ Play</button>
                <button className="btn-danger" onClick={() => setStoryboardEraseConfirm(true)}>Erase</button>
              </div>
            </div>
            {storyboardRecord.sourceUrl && (
              <div className="tile-grid">
                <div className="tile-source">
                  <img
                    src={`${API}${storyboardRecord.sourceUrl}`}
                    alt="Storyboard source atlas"
                    title="Unmodified atlas straight from the model, before crop/resize"
                    className="tile-source-img"
                  />
                  <span className="tile-label">Source Atlas (unmodified, before crop)</span>
                </div>
              </div>
            )}
            <div className="tile-grid">
              {storyboardRecord.slides.map((slide, i) => (
                <div key={slide.url} className="tile-card">
                  <img src={`${API}${slide.url}`} alt={`Slide ${i + 1}`} title={slide.caption} className="tile-img" />
                  <span className="tile-label">Slide {i + 1}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </>}

        {tab === 'props' && <>
        <div className="admin-modules-header">
          <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">🗝️</span>Dungeon Props</h2>
          <button className="btn-primary" onClick={() => setGeneratePropsOpen(true)}>+ Generate Test Batch</button>
        </div>

        {propsManifest.sources.length > 0 && (
          <div className="tile-grid">
            {propsManifest.sources.map(url => (
              <div key={url} className="tile-source">
                <img
                  src={`${API}${url}`}
                  alt="Prop source atlas"
                  title="Click to preview how each cell would be cropped"
                  className="tile-source-img tile-source-clickable"
                  onClick={() => setPreviewFile(url.split('/').pop() ?? null)}
                />
                <span className="tile-label">Source Atlas (click to preview cells)</span>
              </div>
            ))}
          </div>
        )}

        {Object.keys(propsManifest.props).length === 0 && (
          <div className="admin-table-card"><p className="admin-empty">No props generated yet.</p></div>
        )}

        <div className="tile-grid">
          {Object.entries(propsManifest.props).map(([slug, url]) => (
            <div key={slug} className="tile-card">
              <img src={`${API}${url}`} alt={titleCase(slug)} title={titleCase(slug)} className="tile-img" />
              <span className="tile-label">{titleCase(slug)}</span>
            </div>
          ))}
        </div>
        </>}

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

      <GeneratePropsSidebar
        open={generatePropsOpen}
        password={password}
        onClose={() => setGeneratePropsOpen(false)}
        onGenerated={sourceFile => {
          fetchPropsManifest();
          setGeneratePropsOpen(false);
          if (sourceFile) setPreviewFile(sourceFile);
        }}
      />

      <PreviewCellsModal
        file={previewFile}
        password={password}
        onClose={() => setPreviewFile(null)}
      />

      <StoryboardTestModal
        open={storyboardTestOpen}
        password={password}
        record={storyboardRecord}
        onClose={() => setStoryboardTestOpen(false)}
        onGenerated={record => setStoryboardRecord(record)}
      />

      {storyboardPlaying && storyboardRecord && (
        <StoryboardOverlay
          queue={{ entries: [{ characterId: 'storyboard-test', characterName: storyboardRecord.name, slides: storyboardRecord.slides }] } satisfies StoryboardQueuePayload}
          onDone={() => setStoryboardPlaying(false)}
        />
      )}

      {storyboardEraseConfirm && (
        <div className="modal-overlay" onClick={() => !storyboardErasing && setStoryboardEraseConfirm(false)}>
          <dialog className="modal" open onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Erase Storyboard</h2>
              <p className="modal-hint">
                Permanently erase the test storyboard for <strong>{storyboardRecord?.name}</strong>? This removes the portrait and all slides. This cannot be undone.
              </p>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setStoryboardEraseConfirm(false)} disabled={storyboardErasing}>Cancel</button>
              <button className="btn-danger" onClick={() => void confirmEraseStoryboard()} disabled={storyboardErasing}>
                {storyboardErasing ? 'Erasing…' : 'Erase'}
              </button>
            </div>
          </dialog>
        </div>
      )}

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
