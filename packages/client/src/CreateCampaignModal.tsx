import { useRef, useState } from 'react';
import type { WorldConcept } from 'shared';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const API = `http://${window.location.hostname}:3001`;

type Step = 'tags' | 'concepts' | 'generating';

function cacheKey(tags: string[]) { return [...tags].sort().join('|'); }

export default function CreateCampaignModal({ open, onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const streamRef = useRef<HTMLPreElement>(null);
  // ponytail: session-level concept cache keyed by sorted tag string — persists across open/close
  const conceptsCache = useRef<Map<string, WorldConcept[]>>(new Map());

  const [step, setStep] = useState<Step>('tags');
  const [campaignType, setCampaignType] = useState<'campaign' | 'one-shot' | 'dungeon-crawl'>('campaign');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loadingConcepts, setLoadingConcepts] = useState(false);
  const [concepts, setConcepts] = useState<WorldConcept[]>([]);
  const [selectedConcept, setSelectedConcept] = useState<WorldConcept | null>(null);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [campaignId, setCampaignId] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setStep('tags');
    setCampaignType('campaign');
    setTagInput('');
    setTags([]);
    setLoadingConcepts(false);
    setConcepts([]);
    setSelectedConcept(null);
    setProgressLines([]);
    setDone(false);
    setCampaignId('');
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function addTag(raw: string) {
    const trimmed = raw.trim().replace(/,+$/, '');
    if (!trimmed || tags.includes(trimmed)) return;
    setTags(t => [...t, trimmed]);
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
      setTagInput('');
    } else if (e.key === 'Backspace' && tagInput === '') {
      setTags(t => t.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    setTags(t => t.filter(x => x !== tag));
  }

  async function generateConcepts(force = false) {
    if (!tags.length) return;

    if (campaignType === 'dungeon-crawl') {
      const concept: WorldConcept = { name: tags[0] ?? 'Dungeon Crawl', description: tags.join(', ') };
      await generate(concept);
      return;
    }

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

  async function generate(conceptOverride?: WorldConcept) {
    const concept = conceptOverride ?? selectedConcept;
    if (!concept) return;
    setStep('generating');
    setProgressLines([]);
    setDone(false);
    setError('');

    try {
      const res = await fetch(`${API}/api/campaigns/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, concept, name: concept.name, type: campaignType }),
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
              if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
            } else if (evt.type === 'complete') {
              setCampaignId(evt.id ?? '');
              setDone(true);
              onCreated();
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

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <dialog ref={dialogRef} className="modal campaign-modal" open onClick={e => e.stopPropagation()}>

        {step === 'tags' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Create Campaign</h2>
              <p className="modal-hint">Add tags to describe your world. The more you add, the richer the generation.</p>
            </div>
            <label className="modal-label">
              Type
              <select className="modal-select" value={campaignType} onChange={e => setCampaignType(e.target.value as 'campaign' | 'one-shot' | 'dungeon-crawl')}>
                <option value="campaign">Campaign</option>
                <option value="one-shot">One Shot</option>
                <option value="dungeon-crawl">Dungeon Crawl</option>
              </select>
            </label>
            <div className="tag-input-area">
              <div className="tag-chips">
                {tags.map(tag => (
                  <span key={tag} className="tag-chip">
                    {tag}
                    <button className="tag-chip-remove" onClick={() => removeTag(tag)}>×</button>
                  </span>
                ))}
                <input
                  className="tag-input"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder={tags.length === 0 ? 'e.g. Gothic Horror, Four kingdoms at war…' : 'Add another tag…'}
                  autoFocus
                />
              </div>
              <p className="tag-hint">Press Enter, comma, or click Add to add a tag</p>
              {tagInput.trim() && (
                <button className="btn-add-tag" onClick={() => { addTag(tagInput); setTagInput(''); }}>
                  + Add
                </button>
              )}
            </div>
            {error && <p className="modal-error">{error}</p>}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={handleClose}>Cancel</button>
              <button
                className="btn-primary"
                onClick={generateConcepts}
                disabled={!tags.length || loadingConcepts}
              >
                {loadingConcepts ? 'Generating…' : campaignType === 'dungeon-crawl' ? 'Generate' : 'Generate Concepts'}
              </button>
            </div>
          </>
        )}

        {step === 'concepts' && (
          <>
            <div className="modal-header concepts-header">
              <div>
                <h2 className="modal-title">Choose a World</h2>
                <p className="modal-hint">Select the concept that speaks to you.</p>
              </div>
              <button className="btn-refresh" onClick={refreshConcepts} disabled={loadingConcepts} title="Regenerate concepts">
                {loadingConcepts ? '…' : '↻'}
              </button>
            </div>
            <div className="concept-tiles">
              {concepts.map(concept => (
                <button
                  key={concept.name}
                  className={`concept-tile ${selectedConcept?.name === concept.name ? 'concept-tile--selected' : ''}`}
                  onClick={() => setSelectedConcept(concept)}
                >
                  <span className="concept-tile-name">{concept.name}</span>
                  <span className="concept-tile-desc">{concept.description}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setStep('tags')}>Back</button>
              <button className="btn-primary" onClick={generate} disabled={!selectedConcept}>
                Generate
              </button>
            </div>
          </>
        )}

        {step === 'generating' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{done ? 'World Created' : 'Forging the World…'}</h2>
              {!done && !error && <p className="modal-hint">Building your campaign — this may take a moment.</p>}
            </div>
            <pre ref={streamRef} className="stream-output">
              {progressLines.join('\n') || 'Generating world…'}
            </pre>
            {error && <p className="modal-error">{error}</p>}
            {done && (
              <p className="modal-success">
                <strong>{campaignId}</strong> is ready to play.
              </p>
            )}
            <div className="modal-actions">
              <button className="btn-primary" onClick={handleClose} disabled={!done && !error}>
                {done ? 'Done' : error ? 'Close' : 'Generating…'}
              </button>
            </div>
          </>
        )}

      </dialog>
    </div>
  );
}
