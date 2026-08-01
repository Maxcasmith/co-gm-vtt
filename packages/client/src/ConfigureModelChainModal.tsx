import { useEffect, useState } from 'react';
import type { ModelTier, StoryProvider, ReasoningEffort } from 'shared';
import { STORY_PROVIDERS } from './SettingsSidebar.tsx';

const EFFORT_LEVELS: { id: ReasoningEffort; label: string }[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'maximum', label: 'Maximum' },
];

function supportsEffort(provider: StoryProvider, model: string): boolean {
  return STORY_PROVIDERS.find(p => p.id === provider)?.models.find(m => m.id === model)?.supportsEffort ?? false;
}

interface Props {
  open: boolean;
  tierLabel: 'Thinking' | 'Light';
  chain: ModelTier[];
  onCancel: () => void;
  onConfirm: (chain: ModelTier[]) => void;
}

const API = `http://${window.location.hostname}:3001`;

type NodeStatus = 'neutral' | 'testing' | 'ok' | 'fail';

export default function ConfigureModelChainModal({ open, tierLabel, chain, onCancel, onConfirm }: Props) {
  const [draft, setDraft] = useState<ModelTier[]>(chain);
  const [statuses, setStatuses] = useState<NodeStatus[]>(chain.map(() => 'neutral'));
  const [testing, setTesting] = useState(false);
  const [summary, setSummary] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(chain);
    setStatuses(chain.map(() => 'neutral'));
    setSummary('');
  }, [open, chain]);

  if (!open) return null;

  function addNode() {
    const first = STORY_PROVIDERS[0]!;
    const model = first.models[0]!.id;
    setDraft(d => [...d, { provider: first.id, model, ...(supportsEffort(first.id, model) ? { effort: 'high' as ReasoningEffort } : {}) }]);
    setStatuses(s => [...s, 'neutral']);
    setSummary('');
  }

  function removeNode(index: number) {
    setDraft(d => d.filter((_, i) => i !== index));
    setStatuses(s => s.filter((_, i) => i !== index));
    setSummary('');
  }

  function updateProvider(index: number, provider: StoryProvider) {
    const models = STORY_PROVIDERS.find(p => p.id === provider)?.models ?? [];
    const model = models[0]?.id ?? '';
    setDraft(d => d.map((node, i) => i === index
      ? { provider, model, ...(supportsEffort(provider, model) ? { effort: 'high' as ReasoningEffort } : {}) }
      : node));
    setSummary('');
  }

  function updateModel(index: number, model: string) {
    setDraft(d => d.map((node, i) => {
      if (i !== index) return node;
      if (!supportsEffort(node.provider, model)) {
        const { effort: _effort, ...rest } = node;
        return { ...rest, model };
      }
      return { ...node, model, effort: node.effort ?? 'high' };
    }));
    setSummary('');
  }

  function updateEffort(index: number, effort: ReasoningEffort) {
    setDraft(d => d.map((node, i) => i === index ? { ...node, effort } : node));
    setSummary('');
  }

  async function handleTest() {
    if (!draft.length) return;
    setTesting(true);
    setStatuses(draft.map(() => 'testing'));
    setSummary('');
    try {
      const res = await fetch(`${API}/api/config/test-chain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain: draft }),
      });
      const { results } = await res.json() as { results: ('ok' | 'fail')[] };
      setStatuses(results);
      const failed = draft.filter((_, i) => results[i] === 'fail');
      setSummary(failed.length
        ? `${failed.length} of ${draft.length} model${draft.length === 1 ? '' : 's'} failed: ${failed.map(n => n.model).join(', ')}`
        : 'All models connected');
    } catch {
      setStatuses(draft.map(() => 'fail'));
      setSummary('Test request failed');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <dialog className="modal chain-modal" open onClick={e => e.stopPropagation()}>
        <h2 className="modal-title">Configure {tierLabel} Model</h2>

        <div className="chain-row">
          {draft.map((node, i) => {
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
          <button className="btn-test" onClick={() => void handleTest()} disabled={testing || !draft.length}>
            {testing ? 'Testing…' : 'Test Chain'}
          </button>
          {summary && <span className="chain-summary">{summary}</span>}
        </div>

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={() => onConfirm(draft)}>Confirm</button>
        </div>
      </dialog>
    </div>
  );
}
