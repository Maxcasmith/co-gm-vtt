import { useState } from 'react';
import AdminPageShell from './AdminPageShell.tsx';
import GeneratePropsSidebar from './GeneratePropsSidebar.tsx';
import PreviewCellsModal from './PreviewCellsModal.tsx';
import Paginated, { PageSizeSelect } from './Paginated.tsx';
import { titleCase } from './adminUtils.ts';

const API = `http://${window.location.hostname}:3001`;

interface PropSpriteItem { slug: string; url: string }

interface Props {
  password: string;
  onHome: () => void;
}

export default function AdminPropsPage({ password, onHome }: Props) {
  const [propsSources, setPropsSources] = useState<string[]>([]);
  const [propsReloadKey, setPropsReloadKey] = useState(0);
  const [propsPageSize, setPropsPageSize] = useState(24);
  const [generatePropsOpen, setGeneratePropsOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);

  // `sources` (the raw atlas previews) come back identically on every page — captured as a side
  // effect here rather than exposed through Paginated's children, since it isn't part of the paged
  // item list itself.
  function fetchPropsPage(page: number, pageSize: number) {
    return fetch(`${API}/api/props/manifest?page=${page}&pageSize=${pageSize}`)
      .then(r => r.json() as Promise<{ props: PropSpriteItem[]; total: number; sources: string[] }>)
      .then(data => { setPropsSources(data.sources); return { items: data.props, total: data.total }; });
  }

  return (
    <>
    <AdminPageShell title="Props" onHome={onHome}>
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
    </AdminPageShell>

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
    </>
  );
}
