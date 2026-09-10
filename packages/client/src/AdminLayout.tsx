import { useState } from 'react';
import { Button } from './components/Button/Button.tsx';
import SettingsSidebar from './SettingsSidebar.tsx';
import AdminHomePage from './AdminHomePage.tsx';
import AdminCampaignsPage from './AdminCampaignsPage.tsx';
import AdminModulesPage from './AdminModulesPage.tsx';
import AdminTilesPage from './AdminTilesPage.tsx';
import AdminPropsPage from './AdminPropsPage.tsx';
import AdminIconsPage from './AdminIconsPage.tsx';
import AdminItemsPage from './AdminItemsPage.tsx';
import AdminBestiaryPage from './AdminBestiaryPage.tsx';
import AdminStoryboardPage from './AdminStoryboardPage.tsx';
import AdminPlotHooksPage from './AdminPlotHooksPage.tsx';
import './app.css';

const API = `http://${window.location.hostname}:3001`;

export type AdminTab =
  | 'home' | 'campaigns' | 'modules' | 'tiles' | 'props' | 'icons' | 'items' | 'bestiary' | 'storyboard' | 'plot-hooks';

export default function AdminLayout({ initialTab }: { initialTab: AdminTab }) {
  const [password, setPassword] = useState('');
  const [authed, setAuthed]     = useState(false);
  const [error, setError]       = useState('');
  const [tab, setTab]           = useState<AdminTab>(initialTab);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
    window.history.pushState({}, '', next === 'home' ? '/admin' : `/admin/${next}`);
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
          <Button onClick={handleAuth}>Enter</Button>
          <a className="admin-gate-back" href="/">← Back home</a>
        </div>
      </div>
    );
  }

  const onHome = () => goTo('home');

  return (
    <>
      {tab === 'home' && <AdminHomePage onNavigate={goTo} onOpenSettings={() => setSettingsOpen(true)} />}
      {tab === 'campaigns' && <AdminCampaignsPage password={password} onHome={onHome} />}
      {tab === 'modules' && <AdminModulesPage onHome={onHome} />}
      {tab === 'tiles' && <AdminTilesPage password={password} onHome={onHome} />}
      {tab === 'props' && <AdminPropsPage password={password} onHome={onHome} />}
      {tab === 'icons' && <AdminIconsPage onHome={onHome} />}
      {tab === 'items' && <AdminItemsPage password={password} onHome={onHome} />}
      {tab === 'bestiary' && <AdminBestiaryPage password={password} onHome={onHome} />}
      {tab === 'storyboard' && <AdminStoryboardPage password={password} onHome={onHome} />}
      {tab === 'plot-hooks' && <AdminPlotHooksPage password={password} onHome={onHome} />}

      <SettingsSidebar open={settingsOpen} password={password} onClose={() => setSettingsOpen(false)} onPasswordChanged={setPassword} />
    </>
  );
}
