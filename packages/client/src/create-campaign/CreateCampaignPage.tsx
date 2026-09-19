import { useRef, useState } from 'react';
import type { CompendiumMeta, SavedAdventureMeta, WorldConcept, CampaignGenre } from 'shared';
import { Button } from '../components/Button/Button.tsx';
import ChooseSourceStep, { type Choice } from './ChooseSourceStep.tsx';
import PromptsStep from './PromptsStep.tsx';
import ConceptsStep from './ConceptsStep.tsx';
import TitleStep from './TitleStep.tsx';
import NameStep from './NameStep.tsx';
import GeneratingStep from './GeneratingStep.tsx';
import { passwordsMismatch } from './passwordUtils.ts';
import '../app.css';
import '../styles/create-campaign.css';

const API = `http://${window.location.hostname}:3001`;

type Step = 'choose' | 'prompts' | 'concepts' | 'title' | 'name' | 'generating';
type Source = 'new' | 'module' | 'adventure';

// Which rail entries show depends on the path taken: a fresh campaign goes through concepts
// then a rename step, a dungeon crawl skips concepts (matches the 'prompts' handler's own
// branch) but still gets the rename step, module/adventure skip straight to naming.
function railStepsFor(source: Source, campaignType: 'campaign' | 'dungeon-crawl'): Step[] {
  if (source === 'new') {
    return campaignType === 'campaign'
      ? ['choose', 'prompts', 'concepts', 'title', 'generating']
      : ['choose', 'prompts', 'title', 'generating'];
  }
  return ['choose', 'name', 'generating'];
}

function cacheKey(tags: string[]) { return [...tags].sort().join('|'); }

// Web hands off tags via ?tags=a,b,c when redirecting a logged-in cloud user straight into
// this page — cross-origin, so a URL param is the only handoff channel that survives the navigation.
function tagsFromQuery(): string[] {
  const raw = new URLSearchParams(window.location.search).get('tags');
  if (!raw) return [];
  return raw.split(',').map(t => t.trim()).filter(Boolean);
}

export default function CreateCampaignPage() {
  const conceptsCache = useRef<Map<string, WorldConcept[]>>(new Map());
  const initialTags = tagsFromQuery();

  const [step, setStep] = useState<Step>(initialTags.length ? 'prompts' : 'choose');
  const [choice, setChoice] = useState<Choice | null>(initialTags.length ? { kind: 'type', type: 'campaign' } : null);
  const [source, setSource] = useState<Source>('new');
  const [campaignType, setCampaignType] = useState<'campaign' | 'dungeon-crawl'>('campaign');
  const [partySize, setPartySize] = useState(4);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [genre, setGenre] = useState<CampaignGenre | null>(null);
  const [loadingConcepts, setLoadingConcepts] = useState(false);
  const [concepts, setConcepts] = useState<WorldConcept[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<WorldConcept | null>(null);
  const [selectedModule, setSelectedModule] = useState<CompendiumMeta | null>(null);
  const [selectedAdventure, setSelectedAdventure] = useState<SavedAdventureMeta | null>(null);
  const [campaignName, setCampaignName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [rawOutput, setRawOutput] = useState('');
  const [done, setDone] = useState(false);
  const [campaignId, setCampaignId] = useState('');
  const [error, setError] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  async function generateConcepts(force = false) {
    if (!tags.length) return;

    const key = cacheKey(tags);
    if (!force) {
      const cached = conceptsCache.current.get(key);
      if (cached) { setConcepts(cached); setSelectedConcept(cached[0] ?? null); setStep('concepts'); return; }
    }
    setLoadingConcepts(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/campaigns/concepts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, type: campaignType }),
      });
      const data = await r.json() as WorldConcept[] | { error: string };
      if ('error' in data) throw new Error(data.error);
      conceptsCache.current.set(key, data);
      setConcepts(data);
      setSelectedConcept(data[0] ?? null);
      setStep('concepts');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate concepts');
    } finally {
      setLoadingConcepts(false);
    }
  }

  function refreshConcepts() {
    conceptsCache.current.delete(cacheKey(tags));
    void generateConcepts(true);
  }

  // Best-effort: the campaign already exists by the time this runs, so a failure here shouldn't
  // block "done" — it just means the game stays unprotected until set from Game Settings.
  async function applyGamePassword(newCampaignId: string) {
    if (!password) return;
    try {
      await fetch(`${API}/api/campaigns/${newCampaignId}/game-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gamePassword: password }),
      });
    } catch {
      setError('Campaign created, but the password could not be set — set one from Game Settings.');
    }
  }

  async function generate() {
    const concept = selectedConcept;
    if (!concept) return;
    setStep('generating');
    setProgressLines([]);
    setRawOutput('');
    setDone(false);
    setError('');

    try {
      const res = await fetch(`${API}/api/campaigns/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, concept, name: campaignName, type: campaignType, partySize, genre }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; id?: string; message?: string; text?: string };
            if (evt.type === 'progress') {
              setProgressLines(l => [...l, evt.message ?? '']);
            } else if (evt.type === 'token') {
              setRawOutput(r => r + (evt.text ?? ''));
            } else if (evt.type === 'complete') {
              setCampaignId(evt.id ?? '');
              await applyGamePassword(evt.id ?? '');
              setDone(true);
            } else if (evt.type === 'error') {
              setError(evt.message ?? 'Generation failed');
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }

  async function createFromModule() {
    if (!selectedModule || !campaignName) return;
    setStep('generating');
    setProgressLines([]);
    setDone(false);
    setError('');

    try {
      const res = await fetch(`${API}/api/campaigns/from-module`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adventureSlug: selectedModule.slug, campaignName }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; id?: string; message?: string };
            if (evt.type === 'progress') {
              setProgressLines(l => [...l, evt.message ?? '']);
            } else if (evt.type === 'complete') {
              setCampaignId(evt.id ?? '');
              await applyGamePassword(evt.id ?? '');
              setDone(true);
            } else if (evt.type === 'error') {
              setError(evt.message ?? 'Failed to create campaign');
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    }
  }

  async function createFromAdventure() {
    if (!selectedAdventure || !campaignName) return;
    setStep('generating');
    setProgressLines(['Copying saved adventure…']);
    setDone(false);
    setError('');

    try {
      const res = await fetch(`${API}/api/campaigns/from-adventure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adventureSlug: selectedAdventure.slug, campaignName }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to create campaign');
      setCampaignId(data.id ?? '');
      await applyGamePassword(data.id ?? '');
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      /* noop */
    }
  }

  function handleChoose(next: Choice) {
    setChoice(next);
  }

  async function handleNext() {
    if (step === 'choose') {
      if (!choice) return;
      if (choice.kind === 'type') {
        setSource('new');
        setCampaignType(choice.type);
        setStep('prompts');
      } else if (choice.kind === 'module') {
        setSource('module');
        setSelectedModule(choice.module);
        setCampaignName('');
        setStep('name');
      } else {
        setSource('adventure');
        setSelectedAdventure(choice.adventure);
        setCampaignName('');
        setStep('name');
      }
      return;
    }
    if (step === 'prompts') {
      if (campaignType === 'dungeon-crawl') {
        // No concepts step for a dungeon crawl — synthesize the same placeholder concept the
        // concepts step would otherwise have produced, then go straight to naming it.
        setSelectedConcept({ name: tags[0] ?? 'Dungeon Crawl', description: tags.join(', ') });
        setCampaignName(tags[0] ?? 'Dungeon Crawl');
        setStep('title');
        return;
      }
      await generateConcepts();
      return;
    }
    if (step === 'concepts') {
      if (selectedConcept) setCampaignName(selectedConcept.name);
      setStep('title');
      return;
    }
    if (step === 'title') { await generate(); return; }
    if (step === 'name') {
      if (source === 'module') await createFromModule();
      else await createFromAdventure();
    }
  }

  function handleBack() {
    if (step === 'prompts') setStep('choose');
    else if (step === 'concepts') setStep('prompts');
    else if (step === 'title') setStep(campaignType === 'campaign' ? 'concepts' : 'prompts');
    else if (step === 'name') setStep('choose');
  }

  const nextDisabled = {
    choose: choice === null,
    prompts: tags.length === 0 || genre === null || loadingConcepts,
    concepts: selectedConcept === null || loadingConcepts,
    title: campaignName.trim() === '' || passwordsMismatch(password, confirmPassword),
    name: campaignName.trim() === '' || passwordsMismatch(password, confirmPassword),
    generating: true,
  }[step];

  // Single source of truth for a step's heading — the rail shows the same text as that
  // step's own h1, so the two never drift out of sync.
  function titleFor(s: Step): string {
    switch (s) {
      case 'choose': return 'Start a New Game';
      case 'prompts': return campaignType === 'dungeon-crawl' ? 'Describe the Dungeon' : 'Describe Your World';
      case 'concepts': return 'Choose a World';
      case 'title': return campaignType === 'dungeon-crawl' ? 'Name Your Dungeon' : 'Name Your Campaign';
      case 'name':
        if (source === 'module' && selectedModule) return `Create ${selectedModule.name} Campaign`;
        if (source === 'adventure' && selectedAdventure) return `Play a Copy of ${selectedAdventure.name}`;
        return 'Name It';
      case 'generating': return done ? 'World Created' : 'Forging the World…';
    }
  }

  const railSteps = railStepsFor(source, campaignType);
  const railIndex = railSteps.indexOf(step);
  // Hide steps ahead of where we are — the rail grows as you progress instead of pre-showing
  // the whole path (which would also be misleading before a path is even committed to).
  const visibleRailSteps = railSteps.slice(0, railIndex + 1);

  return (
    <div className="create-page">
      <aside className="create-rail">
        <span className="create-rail-wordmark">Untitled AI VTT</span>
        <ol className="create-rail-steps">
          {visibleRailSteps.map((s, i) => (
            <li
              key={s}
              className={`create-rail-step ${i === railIndex ? 'create-rail-step--current' : ''} ${i < railIndex ? 'create-rail-step--done' : ''}`}
            >
              {titleFor(s)}
            </li>
          ))}
        </ol>
      </aside>

      <div className="create-page-main">
        <div className="create-page-atmosphere" aria-hidden="true" />
        <div className="create-page-body">
          {step === 'choose' && (
          <ChooseSourceStep
            title={titleFor('choose')}
            selected={choice}
            onChoose={handleChoose}
          />
        )}

        {step === 'prompts' && (
          <PromptsStep
            title={titleFor('prompts')}
            campaignType={campaignType}
            tags={tags}
            onTagsChange={setTags}
            partySize={partySize}
            onPartySizeChange={setPartySize}
            genre={genre}
            onGenreChange={setGenre}
          />
        )}

        {step === 'concepts' && (
          <ConceptsStep
            title={titleFor('concepts')}
            concepts={concepts}
            selectedConcept={selectedConcept}
            onSelect={setSelectedConcept}
            onRefresh={refreshConcepts}
            loading={loadingConcepts}
          />
        )}

        {step === 'title' && (
          <TitleStep
            title={titleFor('title')}
            campaignType={campaignType}
            campaignName={campaignName}
            onCampaignNameChange={setCampaignName}
            password={password}
            onPasswordChange={setPassword}
            confirmPassword={confirmPassword}
            onConfirmPasswordChange={setConfirmPassword}
            onSubmit={() => void handleNext()}
          />
        )}

        {step === 'name' && source === 'module' && selectedModule && (
          <NameStep
            title={titleFor('name')}
            sourceType="module"
            entityCount={selectedModule.entityCount}
            campaignName={campaignName}
            onCampaignNameChange={setCampaignName}
            placeholder={selectedModule.name}
            password={password}
            onPasswordChange={setPassword}
            confirmPassword={confirmPassword}
            onConfirmPasswordChange={setConfirmPassword}
            onSubmit={() => void handleNext()}
          />
        )}

        {step === 'name' && source === 'adventure' && selectedAdventure && (
          <NameStep
            title={titleFor('name')}
            sourceType={selectedAdventure.sourceType}
            scenarioSynopsis={selectedAdventure.scenarioSynopsis}
            partySize={selectedAdventure.partySize}
            theme={selectedAdventure.theme}
            entityCount={selectedAdventure.entityCount}
            campaignName={campaignName}
            onCampaignNameChange={setCampaignName}
            placeholder={selectedAdventure.name}
            password={password}
            onPasswordChange={setPassword}
            confirmPassword={confirmPassword}
            onConfirmPasswordChange={setConfirmPassword}
            onSubmit={() => void handleNext()}
          />
        )}

        {step === 'generating' && (
          <GeneratingStep
            title={titleFor('generating')}
            done={done}
            error={error}
            progressLines={progressLines}
            rawOutput={rawOutput}
            campaignId={campaignId}
          />
        )}
        </div>

        <footer className="create-page-footer">
          <Button variant="outline" color="danger" onClick={() => setShowCancelConfirm(true)}>Cancel</Button>
          <div className="create-page-footer-actions">
            {step !== 'generating' && (
              <Button variant="outline" color="secondary" onClick={handleBack} disabled={step === 'choose'}>Back</Button>
            )}
            {step === 'generating' ? (
              done ? (
                <Button navigate={`/${campaignId}/lobby`}>Enter the Lobby</Button>
              ) : error ? (
                <Button navigate="/create">Back to Create</Button>
              ) : (
                <Button disabled>Generating…</Button>
              )
            ) : (
              <Button onClick={() => void handleNext()} disabled={nextDisabled}>
                {loadingConcepts ? 'Generating…' : 'Next'}
              </Button>
            )}
          </div>
        </footer>

        {showCancelConfirm && (
          <div className="modal-overlay" onClick={() => setShowCancelConfirm(false)}>
            <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h2 className="modal-title">Cancel campaign creation?</h2>
                <p className="modal-hint">Your progress on this page will be lost.</p>
              </div>
              <div className="modal-actions">
                <Button variant="outline" color="secondary" onClick={() => setShowCancelConfirm(false)}>
                  Keep Going
                </Button>
                <Button variant="outline" color="danger" navigate="/">Discard</Button>
              </div>
            </dialog>
          </div>
        )}
      </div>
    </div>
  );
}
