import { useRef, useState } from 'react';
import type { CompendiumMeta } from 'shared';

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
  resumeAdventure?: CompendiumMeta | null;
}

const API = `http://${window.location.hostname}:3001`;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function UploadModuleModal({ open, onClose, onUploaded, resumeAdventure }: Props) {
  const streamRef = useRef<HTMLPreElement>(null);
  const rawStreamRef = useRef<HTMLPreElement>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState('');
  const [rawOutput, setRawOutput] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setName('');
    setFile(null);
    setProgress('');
    setRawOutput('');
    setUploading(false);
    setPausing(false);
    setPaused(false);
    setActiveSlug(null);
    setDone(false);
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !name) {
      setName(f.name.replace(/\.md$/i, ''));
    }
  }

  async function handlePause() {
    if (!activeSlug || pausing) return;
    setPausing(true);
    await fetch(`${API}/api/compendium/${activeSlug}/pause`, { method: 'POST' });
  }

  async function handleUpload() {
    const resuming = !!resumeAdventure || paused;
    if (!resuming && (!file || !name)) return;
    const slug = resumeAdventure?.slug ?? activeSlug ?? slugify(name);

    setActiveSlug(slug);
    setUploading(true);
    setPausing(false);
    setPaused(false);
    setProgress('');
    setRawOutput('');
    setError('');
    setDone(false);

    const res = resuming
      ? await fetch(`${API}/api/compendium/${slug}/resume`, { method: 'POST' })
      : await fetch(`${API}/api/compendium/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: await file!.text(), name }),
        });

    try {
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
            const evt = JSON.parse(line.slice(6)) as { type: string; message?: string; text?: string };
            if (evt.type === 'progress') {
              setProgress(p => p ? `${p}\n${evt.message}` : (evt.message ?? ''));
              setRawOutput('');
              if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
            } else if (evt.type === 'token') {
              setRawOutput(r => r + (evt.text ?? ''));
              if (rawStreamRef.current) rawStreamRef.current.scrollTop = rawStreamRef.current.scrollHeight;
            } else if (evt.type === 'complete') {
              setDone(true);
              onUploaded();
            } else if (evt.type === 'paused') {
              setPausing(false);
              setPaused(true);
              onUploaded();
            } else if (evt.type === 'error') {
              setError(evt.message ?? 'Upload failed');
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setUploading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={uploading ? undefined : handleClose}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {done ? 'Module Uploaded' : paused ? 'Extraction Paused' : resumeAdventure ? `Resume Extraction — ${resumeAdventure.name}` : 'Upload Adventure Module'}
          </h2>
          {!done && !paused && !resumeAdventure && <p className="modal-hint">Upload a Markdown adventure file to the compendium. Large modules are processed in sections.</p>}
          {!done && !paused && resumeAdventure && (
            <p className="modal-hint">Continues from section {resumeAdventure.resumeFromChunk + 1} where it previously stopped.</p>
          )}
          {paused && <p className="modal-hint">Progress is saved. Resume now, or save as a draft and come back later.</p>}
        </div>

        {!uploading && !done && !paused && !resumeAdventure && (
          <>
            <label className="modal-label">
              Adventure Name
              <input
                className="modal-input"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Curse of Strahd"
                autoFocus
              />
            </label>
            <label className="modal-label">
              Markdown File
              <input
                className="modal-input"
                type="file"
                accept=".md"
                onChange={handleFileChange}
              />
            </label>
          </>
        )}

        {(uploading || done || paused) && (
          <>
            <pre ref={streamRef} className="stream-output">{progress}</pre>
            {rawOutput && (
              <pre ref={rawStreamRef} className="stream-output stream-output-raw">{rawOutput}</pre>
            )}
            {done && <p className="modal-success"><strong>{resumeAdventure?.name ?? name}</strong> is ready in the compendium.</p>}
          </>
        )}

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          {done || error ? (
            <button className="btn-primary" onClick={handleClose}>Done</button>
          ) : paused ? (
            <>
              <button className="btn-secondary" onClick={() => void handleUpload()}>Resume</button>
              <button className="btn-primary" onClick={handleClose}>Save as Draft</button>
            </>
          ) : uploading ? (
            <button className="btn-primary" onClick={() => void handlePause()} disabled={pausing}>
              {pausing ? 'Pausing…' : 'Pause'}
            </button>
          ) : (
            <>
              <button className="btn-secondary" onClick={handleClose}>Cancel</button>
              <button
                className="btn-primary"
                onClick={() => void handleUpload()}
                disabled={!resumeAdventure && (!file || !name)}
              >
                {resumeAdventure ? 'Resume' : 'Upload'}
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
