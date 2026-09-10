import { useEffect, useState } from 'react';
import type { CompendiumMeta } from 'shared';
import { Button } from './components/Button/Button.tsx';
import AdminPageShell from './AdminPageShell.tsx';
import UploadModuleModal from './UploadModuleModal.tsx';
import Paginated, { PageSizeSelect } from './Paginated.tsx';

const API = `http://${window.location.hostname}:3001`;

interface Props {
  onHome: () => void;
}

export default function AdminModulesPage({ onHome }: Props) {
  const [adventures, setAdventures] = useState<CompendiumMeta[]>([]);
  const [feedback, setFeedback]     = useState<Record<string, string>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resumeAdventure, setResumeAdventure] = useState<CompendiumMeta | null>(null);
  const [pageSize, setPageSize] = useState(10);

  function fetchAdventuresPage(page: number, size: number) {
    const start = (page - 1) * size;
    return Promise.resolve({ items: adventures.slice(start, start + size), total: adventures.length });
  }

  function fetchAdventures() {
    fetch(`${API}/api/compendium`)
      .then(r => r.json())
      .then((data: CompendiumMeta[]) => setAdventures(data))
      .catch(() => setAdventures([]));
  }

  useEffect(() => { fetchAdventures(); }, []);

  async function deleteAdventure(slug: string, name: string) {
    if (!window.confirm(`Permanently delete the module "${name}"? This cannot be undone.`)) return;
    const r = await fetch(`${API}/api/compendium/${slug}`, { method: 'DELETE' });
    if (r.ok) setAdventures(a => a.filter(x => x.slug !== slug));
    else setFeedback(f => ({ ...f, [`module:${slug}`]: 'Failed' }));
  }

  return (
    <>
    <AdminPageShell title="Adventure Modules" onHome={onHome}>
      <div className="admin-modules-header">
        <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">📜</span>Adventure Modules</h2>
        <div className="admin-modules-header-actions">
          <PageSizeSelect value={pageSize} onChange={setPageSize} />
          <Button onClick={() => setUploadOpen(true)}>+ Upload Module</Button>
        </div>
      </div>
      <Paginated key={adventures.length} fetchPage={fetchAdventuresPage} pageSize={pageSize}>
        {pageItems => (
          <div className="admin-table-card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 && (
                  <tr><td colSpan={2} className="admin-empty">No modules uploaded yet.</td></tr>
                )}
                {pageItems.map(adv => (
                  <tr key={adv.slug}>
                    <td className="admin-campaign-name">
                      {adv.name}
                      {adv.status === 'draft' && <span className="admin-draft-badge">draft — paused at section {adv.resumeFromChunk + 1}</span>}
                      <span className="admin-campaign-id">{adv.slug}</span>
                      <span className="admin-module-counts">
                        {[
                          adv.entityCount.npc > 0 && `${adv.entityCount.npc} NPCs`,
                          adv.entityCount.creature > 0 && `${adv.entityCount.creature} creatures`,
                          adv.entityCount.location > 0 && `${adv.entityCount.location} locations`,
                        ].filter(Boolean).join(' · ')}
                      </span>
                      {adv.status === 'draft' && (
                        <Button variant="outline" color="secondary" onClick={() => { setResumeAdventure(adv); setUploadOpen(true); }}>Resume Upload</Button>
                      )}
                    </td>
                    <td>
                      <Button variant="outline" color="danger" onClick={() => void deleteAdventure(adv.slug, adv.name)}>Delete</Button>
                      {feedback[`module:${adv.slug}`] && <span className="admin-feedback">{feedback[`module:${adv.slug}`]}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Paginated>
    </AdminPageShell>

    <UploadModuleModal
      open={uploadOpen}
      onClose={() => { setUploadOpen(false); setResumeAdventure(null); }}
      onUploaded={fetchAdventures}
      resumeAdventure={resumeAdventure}
    />
    </>
  );
}
