import { useEffect, useRef, useState } from 'react';
import type { WorldMeta } from 'shared';
import { CharacterProvider, useCharacter } from './character-creation/CharacterContext.tsx';
import PlayerInfoTab from './character-creation/PlayerInfoTab.tsx';
import BackstoryTab from './character-creation/BackstoryTab.tsx';
import SpellsTab from './character-creation/SpellsTab.tsx';
import ShopTab from './character-creation/ShopTab.tsx';
import FinishedTab from './character-creation/FinishedTab.tsx';
import FightingStyleTab from './character-creation/FightingStyleTab.tsx';
import OrderTab from './character-creation/OrderTab.tsx';
import InvocationsTab from './character-creation/InvocationsTab.tsx';
import { BACKGROUND_SKILLS, CLASS_FEATURES } from './character-creation/srd.ts';
import './app.css';
import './styles/create-campaign.css';

type Tab = 'info' | 'backstory' | 'spells' | 'fightingStyle' | 'classOrder' | 'invocations' | 'shop' | 'finished';

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

function CreatePageInner({ campaignId, campaignName, isCampaign }: { campaignId: string; campaignName: string; isCampaign: boolean }) {
  const c = useCharacter();
  const hasFightingStyle = c.characterClass
    ? (CLASS_FEATURES[c.characterClass] ?? []).some(f => f.name === 'Fighting Style')
    : false;
  const hasClassOrder = c.characterClass
    ? (CLASS_FEATURES[c.characterClass] ?? []).some(f => f.name === 'Divine Order' || f.name === 'Primal Order')
    : false;
  const hasInvocations = c.characterClass
    ? (CLASS_FEATURES[c.characterClass] ?? []).some(f => f.name === 'Eldritch Invocations')
    : false;
  const hasSpellcasting = c.characterClass
    ? (CLASS_FEATURES[c.characterClass] ?? []).some(f => f.name === 'Spellcasting' || f.name === 'Pact Magic')
    : false;
  const backDialogRef = useRef<HTMLDialogElement>(null);
  const successDialogRef = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [createdPassword, setCreatedPassword] = useState('');
  const [copied, setCopied] = useState(false);


  function handleExit() {
    if (c.isDirty) { backDialogRef.current?.showModal(); return; }
    window.location.href = `/${campaignId}/lobby`;
  }

  const steps: Tab[] = [
    'info',
    ...(isCampaign ? ['backstory' as const] : []),
    ...(hasSpellcasting ? ['spells' as const] : []),
    ...(hasFightingStyle ? ['fightingStyle' as const] : []),
    ...(hasClassOrder ? ['classOrder' as const] : []),
    ...(hasInvocations ? ['invocations' as const] : []),
    'shop',
    'finished',
  ];
  const stepIndex = steps.indexOf(c.activeTab);

  function titleFor(tab: Tab): string {
    switch (tab) {
      case 'info': return 'Player Info';
      case 'backstory': return 'Backstory';
      case 'spells': return 'Spells';
      case 'fightingStyle': return 'Fighting Style';
      case 'classOrder': return c.characterClass === 'Cleric' ? 'Divine Order' : 'Primal Order';
      case 'invocations': return 'Invocations';
      case 'shop': return 'Shop';
      case 'finished': return 'Finished';
    }
  }

  function goBack() {
    if (stepIndex > 0) c.set('activeTab', steps[stepIndex - 1]!);
  }

  function goNext() {
    if (stepIndex < steps.length - 1) c.set('activeTab', steps[stepIndex + 1]!);
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
          speciesOriginFeat: c.speciesOriginFeat,
          backstory: c.backstory,
          stats: c.toStats(),
          skillProficiencies: [
            ...(BACKGROUND_SKILLS[c.background] ?? []),
            ...Object.keys(c.skillProficiencies),
          ],
          expertiseSkills: c.expertiseSkills,
          fightingStyle: c.fightingStyle,
          classOrder: c.classOrder,
          invocations: c.invocations,
          portraitPath: c.portraitPath,
          tokenPath: c.tokenPath,
          inventory: c.inventory,
          gold: c.gold,
          spells: Object.keys(c.learnedSpells),
          spellSources: c.learnedSpells,
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
      <aside className="create-rail">
        <span className="create-rail-wordmark">{campaignName}</span>
        <ol className="create-rail-steps">
          {steps.map((tab, i) => (
            <li
              key={tab}
              className={`create-rail-step ${i === stepIndex ? 'create-rail-step--current' : ''} ${i < stepIndex ? 'create-rail-step--done' : ''}`}
            >
              {titleFor(tab)}
            </li>
          ))}
        </ol>
      </aside>

      <div className="create-page-main">
        <div className="create-page-atmosphere" aria-hidden="true" />
        <div className="create-page-body">
          <h1 className="modal-title">{titleFor(c.activeTab)}</h1>
          {c.activeTab === 'backstory' && isCampaign ? <BackstoryTab campaignId={campaignId} />
            : c.activeTab === 'spells' && hasSpellcasting ? <SpellsTab />
            : c.activeTab === 'fightingStyle' && hasFightingStyle ? <FightingStyleTab />
            : c.activeTab === 'classOrder' && hasClassOrder ? <OrderTab />
            : c.activeTab === 'invocations' && hasInvocations ? <InvocationsTab />
            : c.activeTab === 'shop' ? <ShopTab />
            : c.activeTab === 'finished' ? <FinishedTab error={error} />
            : <PlayerInfoTab campaignId={campaignId} />}
        </div>

        <footer className="create-page-footer">
          <button className="create-page-exit" onClick={handleExit}>Cancel</button>
          <div className="create-page-footer-actions">
            <button className="btn-secondary" onClick={goBack} disabled={stepIndex === 0}>Back</button>
            {c.activeTab === 'finished' ? (
              <button className="btn-primary" onClick={handleCreate} disabled={!canCreate || saving}>
                {saving ? 'Creating…' : 'Create Character'}
              </button>
            ) : (
              <button className="btn-primary" onClick={goNext}>Next</button>
            )}
          </div>
        </footer>
      </div>

      {/* back confirmation */}
      <dialog ref={backDialogRef} className="modal">
        <h2 className="modal-title">Discard character?</h2>
        <p className="modal-body-text">Your progress will be lost.</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => backDialogRef.current?.close()}>Keep editing</button>
          <button className="btn-primary" onClick={() => { window.location.href = `/${campaignId}/lobby`; }}>Discard</button>
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
          <button className="btn-primary" onClick={() => { window.location.href = `/${campaignId}/lobby`; }}>Done</button>
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
      <CreatePageInner campaignId={campaignId} campaignName={meta.name} isCampaign={meta.type === 'campaign'} />
    </CharacterProvider>
  );
}
