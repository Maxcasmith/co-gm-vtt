import { useState } from 'react';
import type { Campaign, CompendiumMeta, SavedAdventureMeta } from 'shared';
import SettingsSidebar from './SettingsSidebar.tsx';
import UploadModuleModal from './UploadModuleModal.tsx';
import CreateFromModuleModal from './CreateFromModuleModal.tsx';
import CreateFromAdventureModal from './CreateFromAdventureModal.tsx';
import SaveAdventureModal from './SaveAdventureModal.tsx';
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
  const [savedAdventures, setSavedAdventures] = useState<SavedAdventureMeta[]>([]);
  const [feedback, setFeedback]     = useState<Record<string, string>>({});
  const [settingsOpen, setSettingsOpen]         = useState(false);
  const [uploadOpen, setUploadOpen]             = useState(false);
  const [createCampaignOpen, setCreateCampaignOpen] = useState(false);
  const [selectedAdventure, setSelectedAdventure]   = useState<CompendiumMeta | null>(null);
  const [resumeAdventure, setResumeAdventure]       = useState<CompendiumMeta | null>(null);
  const [selectedSavedAdventure, setSelectedSavedAdventure] = useState<SavedAdventureMeta | null>(null);
  const [saveAdventureCampaign, setSaveAdventureCampaign]   = useState<Campaign | null>(null);

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

  function fetchSavedAdventures() {
    fetch(`${API}/api/adventures`)
      .then(r => r.json())
      .then((data: SavedAdventureMeta[]) => setSavedAdventures(data))
      .catch(() => setSavedAdventures([]));
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
      fetchSavedAdventures();
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

  async function deleteSavedAdventure(slug: string, name: string) {
    if (!window.confirm(`Permanently delete the saved adventure "${name}"? This cannot be undone.`)) return;
    const r = await fetch(`${API}/api/adventures/${slug}`, { method: 'DELETE' });
    if (r.ok) setSavedAdventures(a => a.filter(x => x.slug !== slug));
    else setFeedback(f => ({ ...f, [`adventure:${slug}`]: 'Failed' }));
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
          <a className="admin-gate-back" href="/">← Back home</a>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="admin-panel">
      <div className="admin-atmosphere" aria-hidden="true" />
      <div className="admin-header">
        <a className="btn-secondary admin-header-link admin-header-link--left" href="/">Home</a>
        <div className="admin-header-titles">
          <span className="home-eyebrow">Dungeon Master&apos;s Study</span>
          <h1 className="admin-title">
            <span className="home-title-flourish" aria-hidden="true" />
            Admin
            <span className="home-title-flourish" aria-hidden="true" />
          </h1>
        </div>
        <button className="btn-secondary admin-header-link admin-header-link--right" onClick={() => setSettingsOpen(true)}>Settings</button>
      </div>

      <div className="admin-modules-header">
        <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">⚔</span>Campaigns</h2>
        <button className="btn-primary" onClick={() => setCreateCampaignOpen(true)}>+ Create Campaign</button>
      </div>
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
            {campaigns.length === 0 && (
              <tr><td colSpan={5} className="admin-empty">No campaigns yet.</td></tr>
            )}
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
                  <button className="btn-secondary" onClick={() => setSaveAdventureCampaign(c)}>Save</button>
                </td>
                <td>
                  <button className="btn-danger" onClick={() => void deleteCampaign(c.id, c.name)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-modules-header">
        <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">📜</span>Adventure Modules</h2>
        <button className="btn-primary" onClick={() => setUploadOpen(true)}>+ Upload Module</button>
      </div>
      <div className="admin-table-card">
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
                  {adv.status === 'draft' && <span className="admin-draft-badge">draft — paused at section {adv.resumeFromChunk + 1}</span>}
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
                  {adv.status === 'draft' ? (
                    <button className="btn-secondary" onClick={() => { setResumeAdventure(adv); setUploadOpen(true); }}>Resume</button>
                  ) : (
                    <button className="btn-secondary" onClick={() => setSelectedAdventure(adv)}>Create</button>
                  )}
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
      <div className="admin-modules-header">
        <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">💾</span>Saved Adventures</h2>
      </div>
      <div className="admin-table-card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Adventure</th>
              <th>Create Campaign</th>
              <th>Delete</th>
            </tr>
          </thead>
          <tbody>
            {savedAdventures.length === 0 && (
              <tr><td colSpan={3} className="admin-empty">No saved adventures yet — save a campaign above to reuse it without regenerating.</td></tr>
            )}
            {savedAdventures.map(adv => (
              <tr key={adv.slug}>
                <td className="admin-campaign-name">
                  {adv.name}
                  <span className="admin-campaign-id">{adv.slug}</span>
                  <span className="admin-module-counts">
                    {[
                      adv.entityCount.npc > 0 && `${adv.entityCount.npc} NPCs`,
                      adv.entityCount.creature > 0 && `${adv.entityCount.creature} creatures`,
                      adv.entityCount.location > 0 && `${adv.entityCount.location} locations`,
                      adv.hasDungeon && 'dungeon',
                    ].filter(Boolean).join(' · ')}
                  </span>
                </td>
                <td>
                  <button className="btn-secondary" onClick={() => setSelectedSavedAdventure(adv)}>Create</button>
                </td>
                <td>
                  <button className="btn-danger" onClick={() => void deleteSavedAdventure(adv.slug, adv.name)}>Delete</button>
                  {feedback[`adventure:${adv.slug}`] && <span className="admin-feedback">{feedback[`adventure:${adv.slug}`]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>

    <SettingsSidebar open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    <UploadModuleModal
      open={uploadOpen}
      onClose={() => { setUploadOpen(false); setResumeAdventure(null); }}
      onUploaded={fetchAdventures}
      resumeAdventure={resumeAdventure}
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
    <SaveAdventureModal
      open={saveAdventureCampaign !== null}
      campaign={saveAdventureCampaign}
      password={password}
      onClose={() => setSaveAdventureCampaign(null)}
      onSaved={fetchSavedAdventures}
    />
    <CreateFromAdventureModal
      open={selectedSavedAdventure !== null}
      adventure={selectedSavedAdventure}
      onClose={() => setSelectedSavedAdventure(null)}
      onCreated={fetchCampaigns}
    />
    </>
  );
}
