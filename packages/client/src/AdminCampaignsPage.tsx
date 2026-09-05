import { useEffect, useState } from 'react';
import type { Campaign } from 'shared';
import AdminPageShell from './AdminPageShell.tsx';
import SaveAdventureModal from './SaveAdventureModal.tsx';
import DeleteResourcesModal from './DeleteResourcesModal.tsx';
import Paginated, { PageSizeSelect } from './Paginated.tsx';

const API = `http://${window.location.hostname}:3001`;

function adminHeaders(password: string) {
  return { 'Content-Type': 'application/json', 'x-admin-password': password };
}

interface Props {
  password: string;
  onHome: () => void;
}

export default function AdminCampaignsPage({ password, onHome }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [feedback, setFeedback]   = useState<Record<string, string>>({});
  const [saveAdventureCampaign, setSaveAdventureCampaign] = useState<Campaign | null>(null);
  const [deleteCampaignTarget, setDeleteCampaignTarget]   = useState<Campaign | null>(null);
  const [pageSize, setPageSize] = useState(10);

  function fetchCampaignsPage(page: number, size: number) {
    const start = (page - 1) * size;
    return Promise.resolve({ items: campaigns.slice(start, start + size), total: campaigns.length });
  }

  function fetchCampaigns() {
    fetch(`${API}/api/admin/campaigns`, { headers: adminHeaders(password) })
      .then(r => r.json())
      .then((data: Campaign[]) => setCampaigns(data))
      .catch(() => {});
  }

  useEffect(() => { fetchCampaigns(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function onCampaignDeleted(campaignId: string) {
    // Clear any session/local storage the player may have for this campaign
    try {
      const sessionRaw = sessionStorage.getItem(`vtt-session:${campaignId}`);
      if (sessionRaw) {
        const char = JSON.parse(sessionRaw) as { id?: string };
        if (char.id) {
          const passwords = JSON.parse(localStorage.getItem('vtt-passwords') ?? '{}') as Record<string, string>;
          delete passwords[`${campaignId}:${char.id}`];
          localStorage.setItem('vtt-passwords', JSON.stringify(passwords));
        }
      }
    } catch { /* ignore */ }
    sessionStorage.removeItem(`vtt-session:${campaignId}`);
    setCampaigns(cs => cs.filter(c => c.id !== campaignId));
  }

  async function erase(campaignId: string, type: 'chat' | 'sessions') {
    const label = type === 'chat' ? 'chat history' : 'session notes';
    if (!window.confirm(`Permanently delete ${label} for "${campaignId}"? This cannot be undone.`)) return;
    const r = await fetch(`${API}/api/admin/campaigns/${campaignId}/${type}`, {
      method: 'DELETE',
      headers: adminHeaders(password),
    });
    const key = `${campaignId}:${type}`;
    setFeedback(f => ({ ...f, [key]: r.ok ? 'Erased' : 'Failed' }));
    setTimeout(() => setFeedback(f => { const n = { ...f }; delete n[key]; return n; }), 2500);
  }

  return (
    <>
    <AdminPageShell title="Campaigns" onHome={onHome}>
      <div className="admin-modules-header">
        <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">⚔</span>Campaigns</h2>
        <PageSizeSelect value={pageSize} onChange={setPageSize} />
      </div>
      <Paginated key={campaigns.length} fetchPage={fetchCampaignsPage} pageSize={pageSize}>
        {pageItems => (
          <div className="admin-table-card">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Chat History</th>
                  <th>Session Notes</th>
                  <th>Save as Adventure</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 && (
                  <tr><td colSpan={5} className="admin-empty">No campaigns yet.</td></tr>
                )}
                {pageItems.map(c => (
                  <tr key={c.id}>
                    <td className="admin-campaign-name">{c.name}<span className="admin-campaign-id">{c.id}</span></td>
                    <td>
                      <button className="btn-danger" onClick={() => erase(c.id, 'chat')}>Erase</button>
                      {feedback[`${c.id}:chat`] && <span className="admin-feedback">{feedback[`${c.id}:chat`]}</span>}
                    </td>
                    <td>
                      <button className="btn-danger" onClick={() => erase(c.id, 'sessions')}>Erase</button>
                      {feedback[`${c.id}:sessions`] && <span className="admin-feedback">{feedback[`${c.id}:sessions`]}</span>}
                    </td>
                    <td>
                      <button className="btn-secondary" onClick={() => setSaveAdventureCampaign(c)}>Save</button>
                    </td>
                    <td>
                      <button className="btn-danger" onClick={() => setDeleteCampaignTarget(c)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Paginated>
    </AdminPageShell>

    <SaveAdventureModal
      open={saveAdventureCampaign !== null}
      campaign={saveAdventureCampaign}
      onClose={() => setSaveAdventureCampaign(null)}
      onSaved={() => {}}
    />
    <DeleteResourcesModal
      open={deleteCampaignTarget !== null}
      name={deleteCampaignTarget?.name ?? ''}
      deleteUrl={`/api/admin/campaigns/${deleteCampaignTarget?.id ?? ''}`}
      password={password}
      onClose={() => setDeleteCampaignTarget(null)}
      onDeleted={() => { if (deleteCampaignTarget) onCampaignDeleted(deleteCampaignTarget.id); }}
    />
    </>
  );
}
