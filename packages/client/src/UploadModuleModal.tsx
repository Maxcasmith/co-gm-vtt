import { useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onUploaded: () => void;
}

const API = `http://${window.location.hostname}:3001`;

export default function UploadModuleModal({ open, onClose, onUploaded }: Props) {
  const streamRef = useRef<HTMLPreElement>(null);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [tier, setTier] = useState<'light' | 'thinking'>('light');
  const [progress, setProgress] = useState('');
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  function reset() {
    setName('');
    setFile(null);
    setTier('light');
    setProgress('');
    setUploading(false);
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

  async function handleUpload() {
    if (!file || !name) return;
    setUploading(true);
    setProgress('');
    setError('');
    setDone(false);

    const markdown = await file.text();

    const res = await fetch(`${API}/api/compendium/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown, name, model: tier }),
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
            const evt = JSON.parse(line.slice(6)) as { type: string; message?: string; slug?: string };
            if (evt.type === 'progress') {
              setProgress(p => p ? `${p}\n${evt.message}` : (evt.message ?? ''));
              if (streamRef.current) streamRef.current.scrollTop = streamRef.current.scrollHeight;
            } else if (evt.type === 'complete') {
              setDone(true);
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
    <div className="modal-overlay" onClick={handleClose}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{done ? 'Module Uploaded' : 'Upload Adventure Module'}</h2>
          {!done && <p className="modal-hint">Upload a Markdown adventure file to the compendium. Large modules are processed in sections.</p>}
        </div>

        {!uploading && !done && (
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
            <label className="modal-label">
              Extraction Quality
              <select className="modal-select" value={tier} onChange={e => setTier(e.target.value as 'light' | 'thinking')}>
                <option value="light">Fast (light tier)</option>
                <option value="thinking">Thorough (thinking tier)</option>
              </select>
            </label>
          </>
        )}

        {(uploading || done) && (
          <>
            <pre ref={streamRef} className="stream-output">{progress}</pre>
            {done && <p className="modal-success"><strong>{name}</strong> is ready in the compendium.</p>}
          </>
        )}

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          {done || error ? (
            <button className="btn-primary" onClick={handleClose}>Done</button>
          ) : (
            <>
              <button className="btn-secondary" onClick={handleClose} disabled={uploading}>Cancel</button>
              <button
                className="btn-primary"
                onClick={() => void handleUpload()}
                disabled={!file || !name || uploading}
              >
                {uploading ? 'Extracting…' : 'Upload'}
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
