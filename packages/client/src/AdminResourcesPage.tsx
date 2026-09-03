import { useEffect, useState } from 'react';
import type { StoryboardTestRecord, StoryboardQueuePayload } from 'shared';
import { ABILITY_DEFS } from 'shared';
import GenerateTilesetModal from './GenerateTilesetModal.tsx';
import GeneratePropsSidebar from './GeneratePropsSidebar.tsx';
import PreviewCellsModal from './PreviewCellsModal.tsx';
import BestiaryTab from './BestiaryTab.tsx';
import PlotHooksTab from './PlotHooksTab.tsx';
import Paginated, { PageSizeSelect } from './Paginated.tsx';
import StoryboardTestModal from './StoryboardTestModal.tsx';
import StoryboardOverlay from './StoryboardOverlay.tsx';
import { iconSrcFor } from './ItemIcon.tsx';
import emptyFrameIcon from './assets/icons/Icon-Frame-Blue.jpg';
import { SHOP_ITEMS } from './character-creation/srd.ts';
import CreateIconsModal, { type IconCandidate } from './CreateIconsModal.tsx';
import ItemDetailSidebar, { type DetailSubject } from './ItemDetailSidebar.tsx';

const API = `http://${window.location.hostname}:3001`;

type TilesetManifest = Record<string, Record<string, string[]>>;
interface PropSpriteItem { slug: string; url: string }
type IconsManifest = { icons: Record<string, string>; sources: string[] };
type ResourceTab = 'tiles' | 'props' | 'icons' | 'items' | 'bestiary' | 'storyboard' | 'plot-hooks';

const ICON_MODULES = import.meta.glob('./assets/icons/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const ICONS = Object.entries(ICON_MODULES)
  .map(([path, url]) => ({ name: path.split('/').pop() ?? path, url }))
  .sort((a, b) => a.name.localeCompare(b.name));

function titleCase(s: string): string {
  return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Same resolution ItemIcon uses everywhere else, plus the red "still needs an icon" audit
// highlight this admin view wants — tracked locally since ItemIcon itself is stateless. A freshly
// generated icon just starts resolving on the next mount (see `key={refreshKey}` at the call sites).
function IconCell({ name, iconPath, onClick }: { name: string; iconPath?: string; onClick: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`item-cell${(iconPath || !broken) ? '' : ' item-cell--no-icon'}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <img
        src={iconSrcFor(name, iconPath)}
        alt=""
        className="item-cell-icon"
        onError={e => { setBroken(true); e.currentTarget.onerror = null; e.currentTarget.src = emptyFrameIcon; }}
      />
      <span className="item-cell-name" title={name}>{name}</span>
    </div>
  );
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
  const [propsSources, setPropsSources] = useState<string[]>([]);
  const [propsReloadKey, setPropsReloadKey] = useState(0);
  const [propsPageSize, setPropsPageSize] = useState(24);
  const [generatePropsOpen, setGeneratePropsOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [storyboardRecord, setStoryboardRecord] = useState<StoryboardTestRecord | null>(null);
  const [storyboardTestOpen, setStoryboardTestOpen] = useState(false);
  const [storyboardPlaying, setStoryboardPlaying] = useState(false);
  const [storyboardEraseConfirm, setStoryboardEraseConfirm] = useState(false);
  const [storyboardErasing, setStoryboardErasing] = useState(false);
  const [createIconsOpen, setCreateIconsOpen] = useState(false);
  const [iconsRefreshKey, setIconsRefreshKey] = useState(0);
  const [detailSubject, setDetailSubject] = useState<DetailSubject | null>(null);
  const [iconsManifest, setIconsManifest] = useState<IconsManifest>({ icons: {}, sources: [] });

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

  // `sources` (the raw atlas previews) come back identically on every page — captured as a side
  // effect here rather than exposed through Paginated's children, since it isn't part of the paged
  // item list itself.
  function fetchPropsPage(page: number, pageSize: number) {
    return fetch(`${API}/api/props/manifest?page=${page}&pageSize=${pageSize}`)
      .then(r => r.json() as Promise<{ props: PropSpriteItem[]; total: number; sources: string[] }>)
      .then(data => { setPropsSources(data.sources); return { items: data.props, total: data.total }; });
  }

  function fetchIconsManifest() {
    fetch(`${API}/api/icons/manifest`)
      .then(r => r.json())
      .then((data: IconsManifest) => setIconsManifest(data))
      .catch(() => {});
  }

  useEffect(() => { fetchManifest(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchStoryboardRecord(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Refetch whenever Create Icons / the detail sidebar's generate-or-remove bumps the refresh key.
  useEffect(() => { fetchIconsManifest(); }, [iconsRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const iconCandidates: IconCandidate[] = [
    ...SHOP_ITEMS.filter(item => !item.iconPath).map(item => ({ name: item.name, description: item.description })),
    ...Object.values(ABILITY_DEFS).map(ability => ({ name: ability.label, description: `${ability.label}, a ${ability.class} class combat ability icon.` })),
  ];

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
          <button className={`sheet-tab${tab === 'icons' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('icons')}>Icons</button>
          <button className={`sheet-tab${tab === 'items' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('items')}>Items</button>
          <button className={`sheet-tab${tab === 'bestiary' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('bestiary')}>Bestiary</button>
          <button className={`sheet-tab${tab === 'storyboard' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('storyboard')}>Storyboard</button>
          <button className={`sheet-tab${tab === 'plot-hooks' ? ' sheet-tab--active' : ''}`} onClick={() => setTab('plot-hooks')}>Plot Hooks</button>
        </div>

        {tab === 'bestiary' && <BestiaryTab password={password} />}

        {tab === 'plot-hooks' && <PlotHooksTab password={password} />}

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
          <div className="admin-modules-header-actions">
            <PageSizeSelect value={propsPageSize} onChange={setPropsPageSize} />
            <button className="btn-primary" onClick={() => setGeneratePropsOpen(true)}>+ Generate Test Batch</button>
          </div>
        </div>

        {propsSources.length > 0 && (
          <div className="tile-grid">
            {propsSources.map(url => (
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

        <Paginated key={`props-${propsReloadKey}`} fetchPage={fetchPropsPage} pageSize={propsPageSize}>
          {props => props.length === 0 ? (
            <div className="admin-table-card"><p className="admin-empty">No props generated yet.</p></div>
          ) : (
            <div className="tile-grid">
              {props.map(({ slug, url }) => (
                <div key={slug} className="tile-card">
                  <img src={`${API}${url}`} alt={titleCase(slug)} title={titleCase(slug)} className="tile-img" />
                  <span className="tile-label">{titleCase(slug)}</span>
                </div>
              ))}
            </div>
          )}
        </Paginated>
        </>}

        {tab === 'icons' && <>
        <div className="admin-modules-header">
          <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">🖼️</span>Default Frame</h2>
        </div>
        <p className="modal-hint">The bundled base frame every generated icon reuses — everything else here is generative (see Items tab).</p>

        <div className="tile-grid">
          {ICONS.map(icon => (
            <div key={icon.name} className="tile-card">
              <img src={icon.url} alt={icon.name} title={icon.name} className="tile-img" />
              <span className="tile-label">{icon.name}</span>
            </div>
          ))}
        </div>

        <div className="admin-modules-header">
          <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">✨</span>Generated Icons</h2>
        </div>

        {iconsManifest.sources.length > 0 && (
          <div className="tile-grid">
            {iconsManifest.sources.map(url => (
              <div key={url} className="tile-source">
                <img src={`${API}${url}`} alt="Icon source atlas" className="tile-source-img" />
                <span className="tile-label">Source Atlas (unmodified AI output)</span>
              </div>
            ))}
          </div>
        )}

        {Object.keys(iconsManifest.icons).length === 0 && (
          <div className="admin-table-card"><p className="admin-empty">No icons generated yet — use the Items tab's Create Icons button.</p></div>
        )}

        <div className="tile-grid">
          {Object.entries(iconsManifest.icons).map(([slug, url]) => (
            <div key={slug} className="tile-card">
              <img src={`${API}${url}`} alt={titleCase(slug)} title={titleCase(slug)} className="tile-img" />
              <span className="tile-label">{titleCase(slug)}</span>
            </div>
          ))}
        </div>
        </>}

        {tab === 'items' && <>
        <div className="admin-modules-header">
          <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">🎒</span>Items</h2>
          <button className="btn-primary" onClick={() => setCreateIconsOpen(true)}>Create Icons</button>
        </div>

        <div className="item-grid" key={`items-${iconsRefreshKey}`}>
          {SHOP_ITEMS.map(item => (
            <IconCell
              key={item.id}
              name={item.name}
              iconPath={item.iconPath}
              onClick={() => setDetailSubject({ name: item.name, description: item.description, iconPath: item.iconPath, raw: item as unknown as Record<string, unknown> })}
            />
          ))}
        </div>

        <div className="admin-modules-header">
          <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">✨</span>Combat Abilities</h2>
        </div>

        <div className="item-grid" key={`abilities-${iconsRefreshKey}`}>
          {Object.values(ABILITY_DEFS).map(ability => (
            <IconCell
              key={ability.key}
              name={ability.label}
              onClick={() => setDetailSubject({ name: ability.label, description: `${ability.label}, a ${ability.class} class combat ability icon.`, raw: ability as unknown as Record<string, unknown> })}
            />
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

      <CreateIconsModal
        open={createIconsOpen}
        password={password}
        candidates={iconCandidates}
        onClose={() => setCreateIconsOpen(false)}
        onGenerated={() => setIconsRefreshKey(k => k + 1)}
      />

      <ItemDetailSidebar
        subject={detailSubject}
        password={password}
        onClose={() => setDetailSubject(null)}
        onIconChanged={() => setIconsRefreshKey(k => k + 1)}
      />

      <GeneratePropsSidebar
        open={generatePropsOpen}
        password={password}
        onClose={() => setGeneratePropsOpen(false)}
        onGenerated={sourceFile => {
          setPropsReloadKey(k => k + 1);
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
