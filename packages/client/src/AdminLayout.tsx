import { useState } from 'react';
import AdminPage from './AdminPage.tsx';
import AdminResourcesPage from './AdminResourcesPage.tsx';
import './app.css';

const API = `http://${window.location.hostname}:3001`;

export type AdminTab = 'campaigns' | 'resources';

export default function AdminLayout({ initialTab }: { initialTab: AdminTab }) {
  const [password, setPassword] = useState('');
  const [authed, setAuthed]     = useState(false);
  const [error, setError]       = useState('');
  const [tab, setTab]           = useState<AdminTab>(initialTab);

  async function handleAuth() {
    const r = await fetch(`${API}/api/admin/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await r.json() as { ok: boolean };
    if (r.ok && data.ok) {
      setAuthed(true);
      setError('');
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  }

  function goTo(next: AdminTab) {
    setTab(next);
    window.history.pushState({}, '', next === 'resources' ? '/admin/resources' : '/admin');
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

  return tab === 'resources'
    ? <AdminResourcesPage password={password} onBack={() => goTo('campaigns')} />
    : <AdminPage password={password} onOpenResources={() => goTo('resources')} onPasswordChanged={setPassword} />;
}
