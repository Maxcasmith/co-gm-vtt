import { useEffect, useRef, useState } from 'react';
import type { WorldMeta } from 'shared';
import { DEFAULT_HOUSE_RULES } from 'shared';
import { CharacterProvider, useCharacter, type AttributeMethod } from './character-creation/CharacterContext.tsx';
import { Button } from './components/Button/Button.tsx';
import { CreateRail } from './components/CreateRail/CreateRail.tsx';
import CreationLayout from './character-creation/CreationLayout.tsx';
import ProfileTab from './character-creation/ProfileTab.tsx';
import ClassTab from './character-creation/ClassTab.tsx';
import ClassFeaturesTab, { hasClassFeaturesStep } from './character-creation/ClassFeaturesTab.tsx';
import SpeciesTab from './character-creation/SpeciesTab.tsx';
import AttributesTab from './character-creation/AttributesTab.tsx';
import BackstoryTab from './character-creation/BackstoryTab.tsx';
import SpellsTab from './character-creation/SpellsTab.tsx';
import ShopTab from './character-creation/ShopTab.tsx';
import FinishedTab from './character-creation/FinishedTab.tsx';
import { BACKGROUND_SKILLS, CLASS_FEATURES } from './character-creation/srd.ts';
import './app.css';
import './styles/create-campaign.css';

type Tab = 'profile' | 'class' | 'classFeatures' | 'species' | 'attributes' | 'spells' | 'shop' | 'backstory' | 'finished';

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

function CreatePageInner({ campaignId, campaignName, isCampaign, attributeMethods }: { campaignId: string; campaignName: string; isCampaign: boolean; attributeMethods: typeof DEFAULT_HOUSE_RULES.attributeMethods }) {
  const c = useCharacter();
  const hasClassFeatures = c.characterClass ? hasClassFeaturesStep(c.characterClass) : false;
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
    'profile',
    'class',
    ...(hasClassFeatures ? ['classFeatures' as const] : []),
    'species',
    'attributes',
    ...(hasSpellcasting ? ['spells' as const] : []),
    'shop',
    ...(isCampaign ? ['backstory' as const] : []),
    'finished',
  ];
  const stepIndex = steps.indexOf(c.activeTab);

  function titleFor(tab: Tab): string {
    switch (tab) {
      case 'profile': return 'Profile';
      case 'class': return 'Class';
      case 'classFeatures': return 'Class Features';
      case 'species': return 'Species';
      case 'attributes': return 'Attributes';
      case 'spells': return 'Spells';
      case 'shop': return 'Shop';
      case 'backstory': return 'Backstory';
      case 'finished': return 'Finished';
    }
  }

  function goBack() {
    if (stepIndex > 0) c.set('activeTab', steps[stepIndex - 1]!);
  }

  function goNext() {
    if (stepIndex < steps.length - 1) c.set('activeTab', steps[stepIndex + 1]!);
  }

  const canCreate = c.name.trim() !== '' && c.password.trim() !== '' && c.attributesComplete;

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
      <CreateRail
        wordmark={campaignName}
        steps={steps.map(tab => ({ key: tab, label: titleFor(tab) }))}
        currentIndex={stepIndex}
        onStepClick={tab => c.set('activeTab', tab)}
      />

      <div className="create-page-main">
        <div className="create-page-atmosphere" aria-hidden="true" />
        <div className="create-page-body">
          <h1 className="modal-title">{titleFor(c.activeTab)}</h1>
          <CreationLayout>
            {c.activeTab === 'class' ? <ClassTab />
              : c.activeTab === 'classFeatures' && hasClassFeatures ? <ClassFeaturesTab />
              : c.activeTab === 'species' ? <SpeciesTab />
              : c.activeTab === 'attributes' ? <AttributesTab attributeMethods={attributeMethods} />
              : c.activeTab === 'backstory' && isCampaign ? <BackstoryTab campaignId={campaignId} />
              : c.activeTab === 'spells' && hasSpellcasting ? <SpellsTab />
              : c.activeTab === 'shop' ? <ShopTab />
              : c.activeTab === 'finished' ? <FinishedTab error={error} />
              : <ProfileTab campaignId={campaignId} />}
          </CreationLayout>
        </div>

        <footer className="create-page-footer">
          <Button variant="outline" color="danger" onClick={handleExit}>Cancel</Button>
          <div className="create-page-footer-actions">
            <Button variant="outline" color="secondary" onClick={goBack} disabled={stepIndex === 0}>Back</Button>
            {c.activeTab === 'finished' ? (
              <Button onClick={handleCreate} disabled={!canCreate || saving}>
                {saving ? 'Creating…' : 'Create Character'}
              </Button>
            ) : (
              <Button onClick={goNext}>Next</Button>
            )}
          </div>
        </footer>
      </div>

      {/* back confirmation */}
      <dialog ref={backDialogRef} className="modal">
        <h2 className="modal-title">Discard character?</h2>
        <p className="modal-body-text">Your progress will be lost.</p>
        <div className="modal-actions">
          <Button variant="outline" color="secondary" onClick={() => backDialogRef.current?.close()}>Keep editing</Button>
          <Button navigate={`/${campaignId}/lobby`}>Discard</Button>
        </div>
      </dialog>

      {/* success */}
      <dialog ref={successDialogRef} className="modal">
        <h2 className="modal-title">Character Created</h2>
        <p className="modal-body-text">Save your password — you will need it to join as this character.</p>
        <div className="password-reveal">
          <code className="password-code">{createdPassword}</code>
          <Button variant="ghost" className="btn-copy" onClick={copyPassword}>
            {copied ? '✓ Copied' : 'Copy'}
          </Button>
        </div>
        <div className="modal-actions">
          <Button navigate={`/${campaignId}/lobby`}>Done</Button>
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

  const attributeMethods = meta.houseRules?.attributeMethods ?? DEFAULT_HOUSE_RULES.attributeMethods;
  const initialAttributeMethod: AttributeMethod =
    attributeMethods.diceRoll ? 'roll' : attributeMethods.pointBuy ? 'pointBuy' : 'standardArray';

  return (
    <CharacterProvider id={charId} initialAttributeMethod={initialAttributeMethod}>
      <CreatePageInner campaignId={campaignId} campaignName={meta.name} isCampaign={meta.type === 'campaign'} attributeMethods={attributeMethods} />
    </CharacterProvider>
  );
}
