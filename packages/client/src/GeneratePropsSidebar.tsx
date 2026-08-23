import { useEffect, useRef, useState } from 'react';

interface PropRow {
  slug: string;
  name: string;
  description: string;
}

interface Props {
  open: boolean;
  password: string;
  onClose: () => void;
  onGenerated: (sourceFile: string | null) => void;
}

const API = `http://${window.location.hostname}:3001`;
const MAX_PROPS = 32;

type Step = 'form' | 'generating';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// A saved source atlas's filename, pulled out of generatePropSpriteBatch's own progress line
// ("saved source atlas for review: /api/props/_source/props_123.png") so the caller can jump
// straight to previewing the atlas a run just produced.
function extractSourceFile(progressLines: string[]): string | null {
  for (const line of progressLines) {
    const match = /\/_source\/([^/\s]+)$/.exec(line);
    if (match) return match[1]!;
  }
  return null;
}

export default function GeneratePropsSidebar({ open, password, onClose, onGenerated }: Props) {
  const streamRef = useRef<HTMLPreElement>(null);

  const [step, setStep] = useState<Step>('form');
  const [rows, setRows] = useState<PropRow[]>([{ slug: '', name: '', description: '' }]);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // Prefill with the real prop list from a saved dungeon (the sunken temple) so testing the prompt
  // doesn't require spending money generating a whole new dungeon just to get a batch of names.
  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/admin/props/test-manifest`, { headers: { 'x-admin-password': password } })
      .then(r => r.json())
      .then((data: { props?: PropRow[] }) => {
        if (data.props?.length) setRows(data.props);
      })
      .catch(() => {});
  }, [open, password]);

  function reset() {
    setStep('form');
    setRows([{ slug: '', name: '', description: '' }]);
    setProgressLines([]);
    setDone(false);
    setError('');
  }

  function updateRow(i: number, field: 'name' | 'description', value: string) {
    setRows(r => r.map((row, idx) => {
      if (idx !== i) return row;
      return field === 'name' ? { ...row, name: value, slug: slugify(value) } : { ...row, description: value };
    }));
  }

  function addRow() {
    setRows(r => r.length >= MAX_PROPS ? r : [...r, { slug: '', name: '', description: '' }]);
  }

  function removeRow(i: number) {
    setRows(r => r.length <= 1 ? r : r.filter((_, idx) => idx !== i));
  }

  const validRows = rows.filter(r => r.slug.trim() && r.name.trim() && r.description.trim());

  function handleClose() {
    reset();
    onClose();
  }

  async function generate() {
    if (!validRows.length) return;
    setStep('generating');
    setProgressLines([]);
    setDone(false);
    setError('');

    let lines: string[] = [];
    try {
      const res = await fetch(`${API}/api/admin/props/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ props: validRows }),
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
        const chunkLines = buffer.split('\n');
        buffer = chunkLines.pop() ?? '';
        for (const line of chunkLines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6)) as { type: string; message?: string };
            if (evt.type === 'progress') {
              lines = [...lines, evt.message ?? ''];
              setProgressLines(lines);
              if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
            } else if (evt.type === 'complete') {
              setDone(true);
              onGenerated(extractSourceFile(lines));
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

  const dismissable = step === 'form';

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={dismissable ? handleClose : undefined} />}
      <aside className={`props-sidebar ${open ? 'props-sidebar--open' : ''}`}>
        <div className="props-sidebar-header">
          <h2 className="settings-title">Generate Test Prop Batch</h2>
        </div>

        <div className="props-sidebar-body">
          {step === 'form' && (
            <>
              <p className="modal-hint">
                Fires one atlas request against the current prop prompt — prefilled with the sunken temple dungeon's
                real prop names, so you can test crop/border fixes without paying for a full dungeon generation.
                Always overwrites any existing sprite for a given name.
              </p>

              <div className="modal-label">Props (up to {MAX_PROPS} — unused slots render as blank squares)</div>
              {rows.map((r, i) => (
                <div key={i} className="prop-row">
                  <input
                    className="modal-input"
                    value={r.name}
                    onChange={e => updateRow(i, 'name', e.target.value)}
                    placeholder="name, e.g. Long Table"
                  />
                  <textarea
                    className="modal-textarea prop-row-description"
                    value={r.description}
                    onChange={e => updateRow(i, 'description', e.target.value)}
                    placeholder="visual description, e.g. a long wooden table, water-stained, benches on either side"
                  />
                  <button className="btn-danger prop-row-remove" onClick={() => removeRow(i)} disabled={rows.length <= 1}>
                    Remove
                  </button>
                </div>
              ))}
              <button className="btn-secondary" onClick={addRow} disabled={rows.length >= MAX_PROPS}>+ Add prop</button>
            </>
          )}

          {step === 'generating' && (
            <>
              {!done && !error && <p className="modal-hint">Generating and cropping sprites — this may take a moment.</p>}
              <pre ref={streamRef} className="stream-output">
                {progressLines.join('\n') || 'Starting…'}
              </pre>
              {error && <p className="modal-error">{error}</p>}
              {done && <p className="modal-success">Sprites are ready.</p>}
            </>
          )}
        </div>

        <div className="props-sidebar-footer">
          {step === 'form' && (
            <>
              <button className="btn-secondary" onClick={handleClose}>Cancel</button>
              <button className="btn-primary" onClick={() => void generate()} disabled={!validRows.length}>
                Generate
              </button>
            </>
          )}
          {step === 'generating' && (
            <button className="btn-primary" onClick={handleClose} disabled={!done && !error}>
              {done ? 'Done' : error ? 'Close' : 'Generating…'}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
