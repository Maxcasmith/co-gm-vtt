import { useEffect, useState } from 'react';
import type { AiFeature, AiWorkflow, ModelTier, StoryProvider, ReasoningEffort } from 'shared';
import { STORY_PROVIDERS } from './SettingsSidebar.tsx';

interface Props {
  open: boolean;
  workflows: AiWorkflow[];
  onCancel: () => void;
  onSave: (workflows: AiWorkflow[]) => void;
}

const API = `http://${window.location.hostname}:3001`;

const AI_FEATURES: { id: AiFeature; label: string; description: string; group: string }[] = [
  // ── Narrative ──
  {
    id: 'campaignConcepts', label: 'Campaign Concepts', group: 'Narrative',
    description: 'Writes the opening pitch for a new campaign from its tags. Runs once at campaign creation — quality over speed.',
  },
  {
    id: 'dungeonPremise', label: 'Dungeon Crawl Premise', group: 'Narrative',
    description: 'Writes the short premise for a dungeon-crawl campaign (no full world, just a hook). Runs once at creation.',
  },
  {
    id: 'backstoryGeneration', label: 'Backstory Generation', group: 'Narrative',
    description: 'Drafts a character backstory during character creation. Player is waiting on this — balance speed and quality.',
  },
  {
    id: 'backstoryCheck', label: 'Backstory Check', group: 'Narrative',
    description: 'Scores a player-written backstory against world lore and suggests fixes. Player-facing during character creation.',
  },
  {
    id: 'worldLoreSync', label: 'World Lore Sync', group: 'World',
    description: 'After a character is finalized, extracts NPCs/locations/quest hooks from their backstory into the world. Fire-and-forget background task — never blocks character creation.',
  },
  {
    id: 'nemesisGeneration', label: 'Nemesis Generation', group: 'World',
    description: 'Evaluates surviving enemies after combat to decide if one becomes a recurring nemesis. Runs once per fight, in the background.',
  },
  {
    id: 'dmBrief', label: 'DM Brief', group: 'Narrative',
    description: 'One-time setup brief when a module is imported — picks the starting location from the module’s locations/NPCs/factions.',
  },
  {
    id: 'questGeneration', label: 'Quest Generation', group: 'Narrative',
    description: 'Generates new undiscovered quests when the party is running low. Runs in the background between scenes.',
  },
  {
    id: 'dmChatResponse', label: 'DM Chat Response', group: 'Narrative',
    description: 'The live Virtual DM reply to chat — the most latency-sensitive narrative call, players are watching it stream in real time.',
  },
  {
    id: 'sessionTriage', label: 'Session Triage', group: 'Narrative',
    description: 'End-of-session pass that reads the chat log and creates/updates NPCs, locations, and factions. Background batch job, not time-critical.',
  },
  {
    id: 'sessionRecap', label: 'Session Recap', group: 'Narrative',
    description: 'Summarizes the previous session at the start of a new one. Player-facing but only runs once per session start.',
  },
  {
    id: 'tagEffectProcessing', label: 'Tag & Effect Processing', group: 'Narrative',
    description: 'Parses the Virtual DM’s raw response into structured effects (loot, combat triggers, quest updates). Structured extraction, not prose — a fast model usually suffices.',
  },
  // ── World ──
  {
    id: 'worldGeneration', label: 'World Generation', group: 'World',
    description: 'Generates the full world (locations, factions, NPCs) for a new campaign. Runs once at creation — quality over speed.',
  },
  {
    id: 'dungeonGeneration', label: 'Dungeon Generation', group: 'World',
    description: 'Generates dungeon layouts, both at dungeon-crawl campaign creation and mid-session when a dungeon effect triggers.',
  },
  {
    id: 'worldStateAdvance', label: 'World State Advance', group: 'World',
    description: 'Advances world state and narrative events when the party takes a long rest. Runs in the background, not time-critical.',
  },
  // ── Combat ──
  {
    id: 'combatNarration', label: 'Combat Narration', group: 'Combat',
    description: 'Attack and spell-save flavour text. Fires on every hit mid-combat — favor a fast model so turns don’t stall.',
  },
  {
    id: 'encounterGeneration', label: 'Encounter Generation', group: 'Combat',
    description: 'Generates the enemy roster when combat starts, from recent chat and available nemeses. Runs once per encounter, before the fight begins — a beat of latency here is fine.',
  },
  {
    id: 'improvisedResolution', label: 'Improvised Resolution', group: 'Combat',
    description: 'Resolves freeform player actions mid-combat that don’t match a scripted action (e.g. "I shove him into the pit"). Needs strong reasoning to judge outcomes fairly, but still fires mid-turn.',
  },
  // ── Compendium ──
  {
    id: 'compendium', label: 'Compendium Ingestion', group: 'Compendium',
    description: 'Parses uploaded adventure modules into structured NPCs, creatures, factions, and locations. Runs once per upload in the background — a slower, thorough model works well here.',
  },
];

const AI_FEATURE_GROUPS = [...new Set(AI_FEATURES.map(f => f.group))].map(group => ({
  group,
  features: AI_FEATURES.filter(f => f.group === group),
}));

const EFFORT_LEVELS: { id: ReasoningEffort; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'maximum', label: 'Maximum' },
];

function supportsEffort(provider: StoryProvider, model: string): boolean {
  return STORY_PROVIDERS.find(p => p.id === provider)?.models.find(m => m.id === model)?.supportsEffort ?? false;
}

function newWorkflow(): AiWorkflow {
  return { id: crypto.randomUUID(), name: 'New Workflow', enabled: true, models: [], features: [] };
}

type NodeStatus = 'neutral' | 'testing' | 'ok' | 'fail';

export default function ConfigureAiWorkflowsModal({ open, workflows, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState<AiWorkflow[]>(workflows);
  const [selectedId, setSelectedId] = useState<string>(workflows[0]?.id ?? '');
  const [statuses, setStatuses] = useState<NodeStatus[]>([]);
  const [testing, setTesting] = useState(false);
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(workflows);
    setSelectedId(workflows[0]?.id ?? '');
    setStatuses([]);
    setSummary('');
  }, [open, workflows]);

  if (!open) return null;

  const selected = draft.find(w => w.id === selectedId);

  function updateSelected(fn: (w: AiWorkflow) => AiWorkflow) {
    setDraft(d => d.map(w => w.id === selectedId ? fn(w) : w));
  }

  function selectWorkflow(id: string) {
    setSelectedId(id);
    setStatuses([]);
    setSummary('');
  }

  function handleNewWorkflow() {
    const w = newWorkflow();
    setDraft(d => [...d, w]);
    selectWorkflow(w.id);
  }

  function handleDeleteWorkflow() {
    const remaining = draft.filter(w => w.id !== selectedId);
    setDraft(remaining);
    selectWorkflow(remaining[0]?.id ?? '');
  }

  function toggleEnabled() {
    updateSelected(w => ({ ...w, enabled: !w.enabled }));
  }

  function toggleFeature(feature: AiFeature) {
    setDraft(d => d.map(w => {
      if (w.id === selectedId) {
        const has = w.features.includes(feature);
        return { ...w, features: has ? w.features.filter(f => f !== feature) : [...w.features, feature] };
      }
      return { ...w, features: w.features.filter(f => f !== feature) };
    }));
  }

  function addNode() {
    const first = STORY_PROVIDERS[0]!;
    const model = first.models[0]!.id;
    updateSelected(w => ({ ...w, models: [...w.models, { provider: first.id, model, ...(supportsEffort(first.id, model) ? { effort: 'high' as ReasoningEffort } : {}) }] }));
    setStatuses(s => [...s, 'neutral']);
    setSummary('');
  }

  function removeNode(index: number) {
    updateSelected(w => ({ ...w, models: w.models.filter((_, i) => i !== index) }));
    setStatuses(s => s.filter((_, i) => i !== index));
    setSummary('');
  }

  function updateProvider(index: number, provider: StoryProvider) {
    const models = STORY_PROVIDERS.find(p => p.id === provider)?.models ?? [];
    const model = models[0]?.id ?? '';
    updateSelected(w => ({
      ...w,
      models: w.models.map((node, i) => i === index
        ? { provider, model, ...(supportsEffort(provider, model) ? { effort: 'high' as ReasoningEffort } : {}) }
        : node),
    }));
    setSummary('');
  }

  function updateModel(index: number, model: string) {
    updateSelected(w => ({
      ...w,
      models: w.models.map((node, i) => {
        if (i !== index) return node;
        if (!supportsEffort(node.provider, model)) {
          const { effort: _effort, ...rest } = node;
          return { ...rest, model };
        }
        return { ...node, model, effort: node.effort ?? 'high' };
      }),
    }));
    setSummary('');
  }

  function updateEffort(index: number, effort: ReasoningEffort) {
    updateSelected(w => ({ ...w, models: w.models.map((node, i) => i === index ? { ...node, effort } : node) }));
    setSummary('');
  }

  function updateTimeout(index: number, value: string) {
    const timeoutSeconds = value === '' ? undefined : Math.max(1, Number(value));
    updateSelected(w => ({
      ...w,
      models: w.models.map((node, i) => {
        if (i !== index) return node;
        if (timeoutSeconds === undefined) { const { timeoutSeconds: _t, ...rest } = node; return rest; }
        return { ...node, timeoutSeconds };
      }),
    }));
    setSummary('');
  }

  async function handleTest() {
    const chain: ModelTier[] = selected?.models ?? [];
    if (!chain.length) return;
    setTesting(true);
    setStatuses(chain.map(() => 'testing'));
    setSummary('');
    try {
      const res = await fetch(`${API}/api/config/test-chain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain }),
      });
      const { results } = await res.json() as { results: ('ok' | 'fail')[] };
      setStatuses(results);
      const failed = chain.filter((_, i) => results[i] === 'fail');
      setSummary(failed.length
        ? `${failed.length} of ${chain.length} model${chain.length === 1 ? '' : 's'} failed: ${failed.map(n => n.model).join(', ')}`
        : 'All models connected');
    } catch {
      setStatuses(chain.map(() => 'fail'));
      setSummary('Test request failed');
    } finally {
      setTesting(false);
    }
  }

  function ownerOf(feature: AiFeature): AiWorkflow | undefined {
    return draft.find(w => w.id !== selectedId && w.features.includes(feature));
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <dialog className="modal super-modal" open onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Configure AI Workflows</h2>

        <div className="super-modal-body">
        <div className="workflow-select-row">
          <select
            className="modal-select workflow-select"
            value={selectedId}
            onChange={e => selectWorkflow(e.target.value)}
          >
            {draft.map(w => <option key={w.id} value={w.id}>{w.enabled ? w.name : `${w.name} (disabled)`}</option>)}
          </select>
          <input
            className="modal-input workflow-name-input"
            type="text"
            value={selected?.name ?? ''}
            onChange={e => updateSelected(w => ({ ...w, name: e.target.value }))}
            placeholder="Workflow name"
          />
          <button type="button" className="btn-secondary" onClick={handleNewWorkflow}>New Workflow</button>
        </div>

        {selected && (
          <>
            <div className="workflow-status-row">
              <span className={`workflow-pip ${selected.enabled ? 'workflow-pip--active' : 'workflow-pip--disabled'}`} />
              <span className="workflow-status-label">{selected.enabled ? 'Active' : 'Disabled'}</span>
              <button type="button" className="btn-secondary" onClick={toggleEnabled}>
                {selected.enabled ? 'Disable' : 'Enable'}
              </button>
              <button type="button" className="btn-secondary btn-delete-workflow" onClick={handleDeleteWorkflow}>
                Delete
              </button>
            </div>

            <div className="chain-row">
              {selected.models.map((node, i) => {
                const provider = STORY_PROVIDERS.find(p => p.id === node.provider) ?? STORY_PROVIDERS[0]!;
                return (
                  <div className="chain-node-wrap" key={i}>
                    <div className={`chain-node chain-node--${statuses[i] ?? 'neutral'}`}>
                      <button type="button" className="chain-node-remove" onClick={() => removeNode(i)}>×</button>
                      <select
                        className="modal-select chain-node-select"
                        value={node.provider}
                        onChange={e => updateProvider(i, e.target.value as StoryProvider)}
                      >
                        {STORY_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>
                      <select
                        className="modal-select chain-node-select"
                        value={node.model}
                        onChange={e => updateModel(i, e.target.value)}
                      >
                        {provider.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                      </select>
                      {supportsEffort(node.provider, node.model) && (
                        <select
                          className="modal-select chain-node-select"
                          value={node.effort ?? 'high'}
                          onChange={e => updateEffort(i, e.target.value as ReasoningEffort)}
                        >
                          {EFFORT_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                        </select>
                      )}
                      <input
                        className="modal-input chain-node-timeout"
                        type="number"
                        min={1}
                        placeholder="No timeout"
                        title="Timeout in seconds — empty means no timeout"
                        value={node.timeoutSeconds ?? ''}
                        onChange={e => updateTimeout(i, e.target.value)}
                      />
                    </div>
                    <div className="chain-connector" />
                  </div>
                );
              })}

              <button type="button" className="chain-node chain-node--empty" onClick={addNode}>
                <span className="chain-node-plus">+</span>
                <span>Add Model</span>
              </button>
            </div>

            <div className="chain-test-row">
              <button className="btn-test" onClick={() => void handleTest()} disabled={testing || !selected.models.length}>
                {testing ? 'Testing…' : 'Test Connections'}
              </button>
              {summary && <span className="chain-summary">{summary}</span>}
            </div>

            <div className="feature-groups-grid">
              {AI_FEATURE_GROUPS.map(({ group, features }) => (
                <div key={group} className="feature-group">
                  <h4 className="feature-group-title">{group}</h4>
                  {features.map(f => {
                    const owner = ownerOf(f.id);
                    const checked = selected.features.includes(f.id);
                    return (
                      <label key={f.id} className={`feature-checkbox ${owner ? 'feature-checkbox--claimed' : ''}`} title={f.description}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!!owner}
                          onChange={() => toggleFeature(f.id)}
                        />
                        <span>{f.label}</span>
                        {owner && <span className="feature-checkbox-owner">claimed by {owner.name}</span>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
        </div>

        <div className="modal-actions">
          <button className="btn-primary" onClick={() => onSave(draft)}>Save</button>
        </div>
      </dialog>
    </div>
  );
}
