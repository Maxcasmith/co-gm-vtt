import { useRef, useState } from 'react';
import { iconSlug } from 'shared';

export interface IconCandidate {
  name: string;
  description: string;
}

interface Props {
  open: boolean;
  password: string;
  candidates: IconCandidate[];
  onClose: () => void;
  onGenerated: () => void;
}

const API = `http://${window.location.hostname}:3001`;

type Step = 'select' | 'generating' | 'confirm';

export default function CreateIconsModal({ open, password, candidates, onClose, onGenerated }: Props) {
  const streamRef = useRef<HTMLPreElement>(null);

  const [step, setStep] = useState<Step>('select');
  const [checked, setChecked] = useState<Set<string>>(() => new Set(candidates.map(c => c.name)));
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState<IconCandidate[]>([]);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);

  function reset() {
    setStep('select');
    setChecked(new Set(candidates.map(c => c.name)));
    setProgressLines([]);
    setError('');
    setGenerated([]);
    setKeep(new Set());
    setCommitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function toggle(name: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  function toggleKeep(name: string) {
    setKeep(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }

  const selected = candidates.filter(c => checked.has(c.name));

  async function generate() {
    if (!selected.length) return;
    setStep('generating');
    setProgressLines([]);
    setError('');

    try {
      const res = await fetch(`${API}/api/admin/icons/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ items: selected }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Generation failed');
      }

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
            const evt = JSON.parse(line.slice(6)) as { type: string; message?: string };
            if (evt.type === 'progress') {
              setProgressLines(l => [...l, evt.message ?? '']);
              if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
            } else if (evt.type === 'complete') {
              setGenerated(selected);
              setKeep(new Set(selected.map(c => c.name)));
              setStep('confirm');
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

  // Unchecking an icon on the confirmation screen discards it — deletes whatever generate() just
  // wrote to storage/icons/<name>/icon.jpg, so every display spot's onError fallback takes over
  // again for it, same as if it had never been generated.
  async function commitKept() {
    setCommitting(true);
    try {
      const discarded = generated.filter(c => !keep.has(c.name));
      await Promise.all(discarded.map(c =>
        fetch(`${API}/api/admin/icons/${iconSlug(c.name)}`, { method: 'DELETE', headers: { 'x-admin-password': password } }),
      ));
      onGenerated();
      handleClose();
    } finally {
      setCommitting(false);
    }
  }

  if (!open) return null;

  // No close until generation finishes (success or error) — same "no accidental discard mid-run"
  // rule as GenerateTilesetModal. The confirm step is always dismissable via Keep/Discard instead.
  const dismissable = step === 'select';

  return (
    <div className="modal-overlay" onClick={dismissable ? handleClose : undefined}>
      <dialog className="modal super-modal" open onClick={e => e.stopPropagation()}>
        {dismissable && (
          <button className="sheet-close campaign-modal-close" onClick={handleClose} aria-label="Close">×</button>
        )}

        {step === 'select' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Create Icons</h2>
              <p className="modal-hint">
                Generates a 4x4 icon atlas (up to 16 per batch) reusing the app's default frame style, then crops
                and saves one icon per item to storage/icons/&lt;name&gt;/icon.jpg.
              </p>
            </div>

            <div className="super-modal-body">
              {candidates.length === 0 && <p className="admin-empty">Nothing needs an icon.</p>}

              <div className="icon-candidate-actions">
                <button className="btn-secondary" onClick={() => setChecked(new Set(candidates.map(c => c.name)))}>Select All</button>
                <button className="btn-secondary" onClick={() => setChecked(new Set())}>Select None</button>
              </div>

              <div className="icon-candidate-list">
                {candidates.map(c => (
                  <label key={c.name} className="feature-checkbox">
                    <input type="checkbox" checked={checked.has(c.name)} onChange={() => toggle(c.name)} />
                    <span>{c.name}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={handleClose}>Cancel</button>
              <button className="btn-primary" onClick={() => void generate()} disabled={!selected.length}>
                Confirm ({selected.length})
              </button>
            </div>
          </>
        )}

        {step === 'generating' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Painting the Icons…</h2>
              {!error && <p className="modal-hint">Generating and cropping icons — this may take a moment.</p>}
            </div>

            <div className="super-modal-body">
              <pre ref={streamRef} className="stream-output">
                {progressLines.join('\n') || 'Starting…'}
              </pre>
              {error && <p className="modal-error">{error}</p>}
            </div>

            <div className="modal-actions">
              <button className="btn-primary" onClick={handleClose} disabled={!error}>
                {error ? 'Close' : 'Generating…'}
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Keep These Icons?</h2>
              <p className="modal-hint">Uncheck any you don't want — they'll be discarded instead of saved.</p>
            </div>

            <div className="super-modal-body">
              <div className="icon-candidate-actions">
                <button className="btn-secondary" onClick={() => setKeep(new Set(generated.map(c => c.name)))}>Select All</button>
                <button className="btn-secondary" onClick={() => setKeep(new Set())}>Select None</button>
              </div>

              <div className="tile-grid">
                {generated.map(c => (
                  <div key={c.name} className="tile-card">
                    <label className="icon-confirm-toggle">
                      <input type="checkbox" checked={keep.has(c.name)} onChange={() => toggleKeep(c.name)} />
                      <span>{c.name}</span>
                    </label>
                    <img src={`${API}/api/icons/${iconSlug(c.name)}/icon.jpg`} alt={c.name} title={c.name} className="tile-img" />
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => void commitKept()} disabled={committing}>
                {keep.size === 0 ? 'Discard All' : `Discard ${generated.length - keep.size} Unchecked`}
              </button>
              <button className="btn-primary" onClick={() => void commitKept()} disabled={committing}>
                {committing ? 'Saving…' : `Keep Selected (${keep.size})`}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
