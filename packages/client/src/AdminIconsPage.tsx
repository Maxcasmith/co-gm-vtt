import { useEffect, useState } from 'react';
import AdminPageShell from './AdminPageShell.tsx';
import { titleCase } from './adminUtils.ts';

const API = `http://${window.location.hostname}:3001`;

type IconsManifest = { icons: Record<string, string>; sources: string[] };

const ICON_MODULES = import.meta.glob('./assets/icons/*', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const ICONS = Object.entries(ICON_MODULES)
  .map(([path, url]) => ({ name: path.split('/').pop() ?? path, url }))
  .sort((a, b) => a.name.localeCompare(b.name));

interface Props {
  onHome: () => void;
}

export default function AdminIconsPage({ onHome }: Props) {
  const [iconsManifest, setIconsManifest] = useState<IconsManifest>({ icons: {}, sources: [] });

  useEffect(() => {
    fetch(`${API}/api/icons/manifest`)
      .then(r => r.json())
      .then((data: IconsManifest) => setIconsManifest(data))
      .catch(() => {});
  }, []);

  return (
    <AdminPageShell title="Icons" onHome={onHome}>
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
    </AdminPageShell>
  );
}
