import { useState } from 'react';
import type { Campaign } from 'shared';
import './app.css';

const API = `http://${window.location.hostname}:3001`;

function adminHeaders(password: string) {
  return { 'Content-Type': 'application/json', 'x-admin-password': password };
}

export default function AdminPage() {
  const [password, setPassword]   = useState('');
  const [authed, setAuthed]       = useState(false);
  const [error, setError]         = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [feedback, setFeedback]   = useState<Record<string, string>>({});

  async function handleAuth() {
    const r = await fetch(`${API}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (r.ok) {
      const list = await fetch(`${API}/api/admin/campaigns`, { headers: adminHeaders(password) });
      setCampaigns(await list.json() as Campaign[]);
      setAuthed(true);
    } else {
      setError('Invalid password');
    }
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
    <div className="admin-panel">
      <h1 className="admin-title">Admin</h1>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Chat History</th>
            <th>Session Notes</th>
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
