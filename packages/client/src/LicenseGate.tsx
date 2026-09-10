import { useState, useEffect } from 'react';
import { Button } from './components/Button/Button.tsx';
import './app.css';

const API = `http://${window.location.hostname}:3001`;

export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/api/licenses/status`)
      .then(r => r.json() as Promise<{ valid: boolean }>)
      .then(data => setUnlocked(data.valid))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  async function handleRedeem() {
    const trimmed = code.trim();
    if (!trimmed) {
      setError('License code is required');
      return;
    }
    try {
      const r = await fetch(`${API}/api/licenses/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ licenseCode: trimmed }),
      });
      const data = await r.json() as { valid: boolean };
      if (data.valid) {
        setUnlocked(true);
        setError('');
        return;
      }
      setError('Invalid license code');
    } catch {
      setError('Could not reach license server');
    }
    setCode('');
  }

  if (checking) return null;

  if (unlocked) return <>{children}</>;

  return (
    <div className="admin-gate">
      <div className="admin-gate-card">
        <span className="admin-gate-icon" aria-hidden="true">🔑</span>
        <span className="home-eyebrow">Locked</span>
        <h1 className="admin-title">Enter Your License</h1>
        <p className="admin-gate-sub">Enter your license code to unlock the app.</p>
        {error && <p className="admin-error">{error}</p>}
        <input
          className="modal-input admin-pw-input"
          type="text"
          placeholder="License code"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRedeem()}
          autoFocus
        />
        <Button onClick={handleRedeem}>Unlock</Button>
      </div>
    </div>
  );
}
