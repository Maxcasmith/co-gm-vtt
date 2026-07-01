import { useState } from 'react';
import type { Campaign, CompendiumMeta } from 'shared';
import SettingsSidebar from './SettingsSidebar.tsx';
import UploadModuleModal from './UploadModuleModal.tsx';
import CreateFromModuleModal from './CreateFromModuleModal.tsx';
import CreateCampaignModal from './CreateCampaignModal.tsx';
import './app.css';

const API = `http://${window.location.hostname}:3001`;

function adminHeaders(password: string) {
  return { 'Content-Type': 'application/json', 'x-admin-password': password };
}

export default function AdminPage() {
  const [password, setPassword]     = useState('');
  const [authed, setAuthed]         = useState(false);
  const [error, setError]           = useState('');
  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);
  const [adventures, setAdventures] = useState<CompendiumMeta[]>([]);
  const [feedback, setFeedback]     = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen]         = useState(false);
  const [uploadOpen, setUploadOpen]             = useState(false);
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);
  const [selectedAdventure, setSelectedAdventure]   = useState<CompendiumMeta | null>(null);

  function fetchCampaigns() {
    fetch(`${API}/api/admin/campaigns`, { headers: adminHeaders(password) })
      .then(r => r.json())
      .then((data: Campaign[]) => setCampaigns(data))
      .catch(() => {});
  }

  function fetchAdventures() {
    fetch(`${API}/api/compendium`)
      .then(r => r.json())
      .then((data: CompendiumMeta[]) => setAdventures(data))
      .catch(() => setAdventures([]));
  }

  async function handleAuth() {
    const r = await fetch(`${API}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (r.ok) {
      const list = await fetch(`${API}/api/admin/campaigns`, { headers: adminHeaders(password) });
      setCampaigns(await list.json() as Campaign[]);
      fetchAdventures();
      setAuthed(true);
    } else {
      setError('Invalid password');
    }
  }

  async function deleteCampaign(campaignId: string, campaignName: string) {
    if (!window.confirm(`Permanently delete the entire campaign "${campaignName}"? This cannot be undone.`)) return;
    const r = await fetch(`${API}/api/admin/campaigns/${campaignId}`, {
      method: 'DELETE',
      headers: adminHeaders(password),
    });
    if (r.ok) {
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
    } else setFeedback(f => ({ ...f, [`${campaignId}:delete`]: 'Failed' }));
  }

  async function deleteAdventure(slug: string, name: string) {
    if (!window.confirm(`Permanently delete the module "${name}"? This cannot be undone.`)) return;
    const r = await fetch(`${API}/api/compendium/${slug}`, { method: 'DELETE' });
    if (r.ok) setAdventures(a => a.filter(x => x.slug !== slug));
    else setFeedback(f => ({ ...f, [`module:${slug}`]: 'Failed' }));
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

  if (!authed) {
    return (
      <div className="admin-gate">
        <a className="btn-secondary" href="/">Home</a>
        <h1 className="admin-title">Admin</h1>
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
      </div>
    );
  }

  return (
    <>
    <div className="admin-panel">
      <div className="admin-header">
        <a className="btn-secondary" href="/">Home</a>
        <h1 className="admin-title">Admin</h1>
        <button className="btn-secondary" onClick={() => setSettingsOpen(true)}>Settings</button>
      </div>

      <div className="admin-modules-header">
        <h2 className="admin-section-title">Campaigns</h2>
        <button className="btn-primary" onClick={() => setCreateCampaignOpen(true)}>+ Create Campaign</button>
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Chat History</th>
            <th>Session Notes</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map(c => (
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
                <button className="btn-danger" onClick={() => void deleteCampaign(c.id, c.name)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="admin-modules-header">
        <h2 className="admin-section-title">Adventure Modules</h2>
        <button className="btn-primary" onClick={() => setUploadOpen(true)}>+ Upload Module</button>
      </div>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Module</th>
            <th>Create Campaign</th>
            <th>Delete</th>
          </tr>
        </thead>
        <tbody>
          {adventures.length === 0 && (
            <tr><td colSpan={3} className="admin-empty">No modules uploaded yet.</td></tr>
          )}
          {adventures.map(adv => (
            <tr key={adv.slug}>
              <td className="admin-campaign-name">
                {adv.name}
                <span className="admin-campaign-id">{adv.slug}</span>
                <span className="admin-module-counts">
                  {[
                    adv.entityCount.npc > 0 && `${adv.entityCount.npc} NPCs`,
                    adv.entityCount.creature > 0 && `${adv.entityCount.creature} creatures`,
                    adv.entityCount.location > 0 && `${adv.entityCount.location} locations`,
                  ].filter(Boolean).join(' · ')}
                </span>
              </td>
              <td>
                <button className="btn-secondary" onClick={() => setSelectedAdventure(adv)}>Create</button>
              </td>
              <td>
                <button className="btn-danger" onClick={() => void deleteAdventure(adv.slug, adv.name)}>Delete</button>
                {feedback[`module:${adv.slug}`] && <span className="admin-feedback">{feedback[`module:${adv.slug}`]}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <SettingsSidebar open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    <UploadModuleModal
      open={uploadOpen}
      onClose={() => setUploadOpen(false)}
      onUploaded={fetchAdventures}
    />
    <CreateFromModuleModal
      open={selectedAdventure !== null}
      adventure={selectedAdventure}
      onClose={() => setSelectedAdventure(null)}
      onCreated={fetchCampaigns}
    />
    <CreateCampaignModal
      open={createCampaignOpen}
      onClose={() => setCreateCampaignOpen(false)}
      onCreated={fetchCampaigns}
    />
    </>
  );
}
