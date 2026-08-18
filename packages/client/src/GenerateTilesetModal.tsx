import { useRef, useState } from 'react';

interface Props {
  open: boolean;
  password: string;
  onClose: () => void;
  onGenerated: () => void;
}

const API = `http://${window.location.hostname}:3001`;

type Step = 'form' | 'generating';

export default function GenerateTilesetModal({ open, password, onClose, onGenerated }: Props) {
  const streamRef = useRef<HTMLPreElement>(null);

  const [step, setStep] = useState<Step>('form');
  const [title, setTitle] = useState('');
  const [theme, setTheme] = useState('');
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setStep('form');
    setTitle('');
    setTheme('');
    setProgressLines([]);
    setDone(false);
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function generate() {
    if (!title.trim() || !theme.trim()) return;
    setStep('generating');
    setProgressLines([]);
    setDone(false);
    setError('');

    try {
      const res = await fetch(`${API}/api/admin/tilesets/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ title, theme }),
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
              setDone(true);
              onGenerated();
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

  // Same "no accidental discard" rule as CreateCampaignModal: once generation has started,
  // there's no way out but a finished run (done) or a failed one (error) — no backdrop click,
  // no X button, close button disabled until one of those.
  const dismissable = step === 'form';

  return (
    <div className="modal-overlay" onClick={dismissable ? handleClose : undefined}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        {dismissable && (
          <button className="sheet-close campaign-modal-close" onClick={handleClose} aria-label="Close">×</button>
        )}

        {step === 'form' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Generate Tileset</h2>
              <p className="modal-hint">Generates a 16-material, 4x4 texture atlas (1024x1024) and cuts it into 64x64 tiles for this theme.</p>
            </div>
            <label className="modal-label">
              Title
              <input
                className="modal-input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. gothic_horror — this is the folder/matching key"
                autoFocus
              />
            </label>
            <label className="modal-label">
              Theme
              <input
                className="modal-input"
                value={theme}
                onChange={e => setTheme(e.target.value)}
                placeholder="e.g. Gothic horror cathedral, candlelight, decayed stone"
              />
            </label>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={handleClose}>Cancel</button>
              <button className="btn-primary" onClick={() => void generate()} disabled={!title.trim() || !theme.trim()}>
                Generate
              </button>
            </div>
          </>
        )}

        {step === 'generating' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{done ? 'Tileset Generated' : 'Weaving the Atlas…'}</h2>
              {!done && !error && <p className="modal-hint">Generating and cropping tiles — this may take a moment.</p>}
            </div>
            <pre ref={streamRef} className="stream-output">
              {progressLines.join('\n') || 'Starting…'}
            </pre>
            {error && <p className="modal-error">{error}</p>}
            {done && <p className="modal-success">Tileset is ready to use.</p>}
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
