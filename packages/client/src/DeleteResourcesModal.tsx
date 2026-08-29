import { useState } from 'react';

interface Props {
  open: boolean;
  name: string;
  deleteUrl: string;
  password?: string;
  onClose: () => void;
  onDeleted: () => void;
}

const API = `http://${window.location.hostname}:3001`;

export default function DeleteResourcesModal({ open, name, deleteUrl, password, onClose, onDeleted }: Props) {
  const [tiles, setTiles] = useState(false);
  const [creatures, setCreatures] = useState(false);
  const [propsChecked, setPropsChecked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [messages, setMessages] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  function reset() {
    setTiles(false);
    setCreatures(false);
    setPropsChecked(false);
    setDeleting(false);
    setMessages(null);
    setError('');
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setError('');
    try {
      const res = await fetch(`${API}${deleteUrl}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...(password ? { 'x-admin-password': password } : {}) },
        body: JSON.stringify({ resources: { tiles, creatures, props: propsChecked } }),
      });
      const data = await res.json() as { ok?: boolean; messages?: string[]; error?: string };
      if (!res.ok || data.ok === false) throw new Error(data.error ?? 'Failed to delete');
      onDeleted();
      if (data.messages?.length) setMessages(data.messages);
      else handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={deleting ? undefined : handleClose}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{messages ? 'Deleted' : `Delete "${name}"?`}</h2>
          {!messages && (
            <p className="modal-hint">
              This cannot be undone. Optionally also remove its generated resources — anything still used by
              another campaign or saved adventure is kept automatically.
            </p>
          )}
        </div>

        {!messages && (
          <div className="modal-form">
            <label className="feature-checkbox">
              <input type="checkbox" checked={tiles} onChange={() => setTiles(v => !v)} />
              <span>Tiles</span>
            </label>
            <label className="feature-checkbox">
              <input type="checkbox" checked={creatures} onChange={() => setCreatures(v => !v)} />
              <span>Creatures</span>
            </label>
            <label className="feature-checkbox">
              <input type="checkbox" checked={propsChecked} onChange={() => setPropsChecked(v => !v)} />
              <span>Props</span>
            </label>
          </div>
        )}

        {messages && (
          <div className="modal-form">
            {messages.map((m, i) => <p key={i} className="modal-hint">{m}</p>)}
          </div>
        )}

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          {messages ? (
            <button className="btn-primary" onClick={handleClose}>Done</button>
          ) : (
            <>
              <button className="btn-secondary" onClick={handleClose} disabled={deleting}>Cancel</button>
              <button className="btn-danger" onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
