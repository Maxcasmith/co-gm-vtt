import { useState } from 'react';
import type { Campaign } from 'shared';
import { Button } from './components/Button/Button.tsx';

interface Props {
  open: boolean;
  campaign: Campaign | null;
  onClose: () => void;
  onSaved: () => void;
}

const API = `http://${window.location.hostname}:3001`;

export default function SaveAdventureModal({ open, campaign, onClose, onSaved }: Props) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  function handleClose() {
    setName('');
    setSaving(false);
    setDone(false);
    setError('');
    onClose();
  }

  async function handleSave() {
    if (!campaign || saving) return;
    setSaving(true);
    setError('');

    try {
      const res = await fetch(`${API}/api/campaigns/${campaign.id}/save-adventure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || undefined }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? 'Failed to save adventure');
      setDone(true);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setSaving(false);
    }
  }

  if (!open || !campaign) return null;

  return (
    <div className="modal-overlay" onClick={done || saving ? undefined : handleClose}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{done ? 'Adventure Saved' : `Save "${campaign.name}" as Adventure`}</h2>
          {!saving && !done && (
            <p className="modal-hint">
              Snapshots the world, dungeon, NPCs, and quests as a reusable template — reset to a fresh
              start, no chat log or party carried over. Play copies from it later with no regeneration cost.
            </p>
          )}
        </div>

        {!saving && !done && (
          <div className="modal-form">
            <label className="modal-label">
              Adventure Name
              <input
                className="modal-input"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleSave(); }}
                placeholder={campaign.name}
                autoFocus
              />
            </label>
          </div>
        )}

        {done && <p className="modal-success">Saved to Saved Adventures.</p>}
        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          {done || error ? (
            <Button onClick={handleClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" color="secondary" onClick={handleClose} disabled={saving}>Cancel</Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Saving…' : 'Save Adventure'}
              </Button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
