import { useEffect, useRef, useState } from 'react';
import type { StoryboardTestRecord } from 'shared';

interface Props {
  open: boolean;
  password: string;
  record: StoryboardTestRecord | null;
  onClose: () => void;
  onGenerated: (record: StoryboardTestRecord) => void;
}

const API = `http://${window.location.hostname}:3001`;

type Step = 'form' | 'generating';

// Mirrors GenerateTilesetModal's SSE-streaming shape, but prefills from — and never discards — the
// last saved test record: editing name/backstory here is meant to be cheap, only Generate spends money.
export default function StoryboardTestModal({ open, password, record, onClose, onGenerated }: Props) {
  const streamRef = useRef<HTMLPreElement>(null);

  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [backstory, setBackstory] = useState('');
  const [portraitBase64, setPortraitBase64] = useState('');
  const [portraitPreview, setPortraitPreview] = useState('');
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep('form');
    setName(record?.name ?? '');
    setBackstory(record?.backstory ?? '');
    setPortraitBase64('');
    setPortraitPreview(record?.portraitUrl ? `${API}${record.portraitUrl}` : '');
    setProgressLines([]);
    setDone(false);
    setError('');
  }, [open]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setPortraitBase64(dataUrl.split(',')[1] ?? '');
      setPortraitPreview(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  async function generate() {
    if (!name.trim() || !backstory.trim() || !portraitPreview) return;
    setStep('generating');
    setProgressLines([]);
    setDone(false);
    setError('');

    try {
      const res = await fetch(`${API}/api/admin/storyboard-test/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ name, backstory, ...(portraitBase64 ? { portraitBase64 } : {}) }),
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
            const evt = JSON.parse(line.slice(6)) as { type: string; message?: string; record?: StoryboardTestRecord };
            if (evt.type === 'progress') {
              setProgressLines(l => [...l, evt.message ?? '']);
              if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
            } else if (evt.type === 'complete' && evt.record) {
              setDone(true);
              onGenerated(evt.record);
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

  const dismissable = step === 'form';

  return (
    <div className="modal-overlay" onClick={dismissable ? onClose : undefined}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        {dismissable && (
          <button className="sheet-close campaign-modal-close" onClick={onClose} aria-label="Close">×</button>
        )}

        {step === 'form' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">Storyboard Test</h2>
              <p className="modal-hint">Test the character-storyboard pipeline against any name/portrait/backstory — separate from real characters. The last result stays saved here so you can tweak inputs without losing it.</p>
            </div>
            <label className="modal-label">
              Name
              <input className="modal-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Preston Winchester" autoFocus />
            </label>
            <label className="modal-label">
              Portrait
              <input type="file" accept="image/*" onChange={handleFile} />
            </label>
            {portraitPreview && <img src={portraitPreview} alt="Portrait preview" className="inline-portrait-preview" />}
            <label className="modal-label">
              Backstory
              <textarea
                className="modal-input"
                rows={8}
                value={backstory}
                onChange={e => setBackstory(e.target.value)}
                placeholder="The character's backstory, condensed into 9 first-person storyboard slides…"
              />
            </label>

            <div className="modal-actions">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={() => void generate()} disabled={!name.trim() || !backstory.trim() || !portraitPreview}>
                Generate
              </button>
            </div>
          </>
        )}

        {step === 'generating' && (
          <>
            <div className="modal-header">
              <h2 className="modal-title">{done ? 'Storyboard Generated' : 'Weaving the Storyboard…'}</h2>
              {!done && !error && <p className="modal-hint">Generating the atlas and captions — this may take a moment.</p>}
            </div>
            <pre ref={streamRef} className="stream-output">
              {progressLines.join('\n') || 'Starting…'}
            </pre>
            {error && <p className="modal-error">{error}</p>}
            {done && <p className="modal-success">Storyboard is ready to play.</p>}
            <div className="modal-actions">
              <button className="btn-primary" onClick={onClose} disabled={!done && !error}>
                {done ? 'Done' : error ? 'Close' : 'Generating…'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
