import { useEffect, useRef, useState } from 'react';
import type { WorldMeta } from 'shared';
import { CharacterProvider, useCharacter } from './character-creation/CharacterContext.tsx';
import PlayerInfoTab from './character-creation/PlayerInfoTab.tsx';
import SpellsTab from './character-creation/SpellsTab.tsx';
import ShopTab from './character-creation/ShopTab.tsx';
import { BACKGROUND_SKILLS } from './character-creation/srd.ts';
import './app.css';

interface Props { campaignId: string }

const API = `http://${window.location.hostname}:3001`;

// crypto.randomUUID is only available in secure contexts (HTTPS/localhost)
function genId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── inner page (needs context) ────────────────────────────────────────────────

function CreatePageInner({ campaignId, campaignName }: { campaignId: string; campaignName: string }) {
  const c = useCharacter();
  const backDialogRef = useRef<HTMLDialogElement>(null);
  const successDialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdPassword, setCreatedPassword] = useState('');
  const [copied, setCopied] = useState(false);


  function handleBack() {
    if (c.isDirty) { backDialogRef.current?.showModal(); return; }
    window.location.href = '/';
  }

  const canCreate = c.name.trim() !== '' && c.password.trim() !== '' && c.rolled && c.pool.length === 0;

  async function handleCreate() {
    if (!canCreate) return;
    setSaving(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/campaigns/${campaignId}/party`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: c.id,
          name: c.name,
          password: c.password,
          species: c.species,
          background: c.background,
          class: c.characterClass,
          stats: c.toStats(),
          skillProficiencies: [
            ...(BACKGROUND_SKILLS[c.background] ?? []),
            ...Object.keys(c.skillProficiencies),
          ],
          portraitPath: c.portraitPath,
          tokenPath: c.tokenPath,
          inventory: c.inventory,
          gold: c.gold,
          spells: c.learnedSpells,
          level: 1,
          proficiencyBonus: 2,
          campaignId,
        }),
      });
      const data = await r.json() as { id?: string; error?: string };
      if (data.error) throw new Error(data.error);

      // persist to localStorage for autofill
      const store = JSON.parse(localStorage.getItem('vtt-passwords') ?? '{}') as Record<string, string>;
      store[`${campaignId}:${data.id}`] = c.password;
      localStorage.setItem('vtt-passwords', JSON.stringify(store));

      setCreatedPassword(c.password);
      successDialogRef.current?.showModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create character');
    } finally {
      setSaving(false);
    }
  }

  function copyPassword() {
    void navigator.clipboard.writeText(createdPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="create-page">
      <header className="create-header">
        <button className="btn-back" onClick={handleBack}>← Back</button>
        <div className="create-header-titles">
          <span className="create-campaign-name">{campaignName}</span>
          <h1 className="create-title">Character Creation</h1>
        </div>
      </header>

      <nav className="tab-nav">
        <button
          className={`tab-btn ${c.activeTab === 'info' ? 'tab-btn--active' : ''}`}
          onClick={() => c.set('activeTab', 'info')}
        >
          Player Info
        </button>
        <button
          className={`tab-btn ${c.activeTab === 'spells' ? 'tab-btn--active' : ''}`}
          onClick={() => c.set('activeTab', 'spells')}
        >
          Spells
        </button>
        <button
          className={`tab-btn ${c.activeTab === 'shop' ? 'tab-btn--active' : ''}`}
          onClick={() => c.set('activeTab', 'shop')}
        >
          Shop
        </button>
      </nav>

      <div className="create-body">
        {c.activeTab === 'spells' ? <SpellsTab />
          : c.activeTab === 'shop' ? <ShopTab />
          : <PlayerInfoTab campaignId={campaignId} />}
      </div>

      {error && <p className="modal-error create-error">{error}</p>}

      <footer className="create-footer">
        <button className="btn-primary" onClick={handleCreate} disabled={!canCreate || saving}>
          {saving ? 'Creating…' : 'Create Character'}
        </button>
      </footer>

      {/* back confirmation */}
      <dialog ref={backDialogRef} className="modal">
        <h2 className="modal-title">Discard character?</h2>
        <p className="modal-body-text">Your progress will be lost.</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => backDialogRef.current?.close()}>Keep editing</button>
          <button className="btn-primary" onClick={() => { window.location.href = '/'; }}>Discard</button>
        </div>
      </dialog>

      {/* success */}
      <dialog ref={successDialogRef} className="modal">
        <h2 className="modal-title">Character Created</h2>
        <p className="modal-body-text">Save your password — you will need it to join as this character.</p>
        <div className="password-reveal">
          <code className="password-code">{createdPassword}</code>
          <button className="btn-copy" onClick={copyPassword}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn-primary" onClick={() => { window.location.href = '/'; }}>Done</button>
        </div>
      </dialog>
    </div>
  );
}

// ── outer shell (fetches meta, provides context) ──────────────────────────────

export default function PlayerCreatePage({ campaignId }: Props) {
  const [meta, setMeta] = useState<WorldMeta | null>(null);
  const charId = useRef(genId()).current;

  useEffect(() => {
    fetch(`${API}/api/campaigns/${campaignId}`)
      .then(r => r.json())
      .then((m: WorldMeta) => setMeta(m))
      .catch(() => {});
  }, [campaignId]);

  if (!meta) {
    return <div className="error">Loading campaign…</div>;
  }

  return (
    <CharacterProvider id={charId}>
      <CreatePageInner campaignId={campaignId} campaignName={meta.name} />
    </CharacterProvider>
  );
}
