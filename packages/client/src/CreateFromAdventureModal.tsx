import { useState } from 'react';
import type { SavedAdventureMeta } from 'shared';

interface Props {
  open: boolean;
  adventure: SavedAdventureMeta | null;
  onClose: () => void;
  onCreated: () => void;
}

const API = `http://${window.location.hostname}:3001`;

export default function CreateFromAdventureModal({ open, adventure, onClose, onCreated }: Props) {
  const [campaignName, setCampaignName] = useState('');
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  function handleClose() {
    setCampaignName('');
    setCreating(false);
    setDone(false);
    setError('');
    onClose();
  }

  async function handleCreate() {
    if (!adventure || !campaignName) return;
    setCreating(true);
    setError('');

    try {
      const res = await fetch(`${API}/api/campaigns/from-adventure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adventureSlug: adventure.slug, campaignName }),
      });
      const data = await res.json() as { id?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to create campaign');
      setDone(true);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setCreating(false);
    }
  }

  if (!open || !adventure) return null;

  const entityLine = [
    adventure.entityCount.npc > 0 && `${adventure.entityCount.npc} NPCs`,
    adventure.entityCount.creature > 0 && `${adventure.entityCount.creature} creatures`,
    adventure.entityCount.faction > 0 && `${adventure.entityCount.faction} factions`,
    adventure.entityCount.location > 0 && `${adventure.entityCount.location} locations`,
    adventure.hasDungeon && 'a dungeon',
  ].filter(Boolean).join(', ');

  return (
    <div className="modal-overlay" onClick={done || creating ? undefined : handleClose}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {done ? `${adventure.name} Copy Ready` : `Play a Copy of ${adventure.name}`}
          </h2>
          {!creating && !done && entityLine && <p className="modal-hint">{entityLine}</p>}
        </div>

        {!creating && !done && (
          <div className="modal-form">
            <label className="modal-label">
              Campaign Name
              <input
                className="modal-input"
                type="text"
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleCreate(); }}
                placeholder={adventure.name}
                autoFocus
              />
            </label>
          </div>
        )}

        {done && (
          <p className="modal-success">
            Campaign created from the saved template — no generation needed, fresh party ready to join.
          </p>
        )}

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          {done || error ? (
            <button className="btn-primary" onClick={handleClose}>Done</button>
          ) : (
            <>
              <button className="btn-secondary" onClick={handleClose} disabled={creating}>Cancel</button>
              <button
                className="btn-primary"
                onClick={() => void handleCreate()}
                disabled={!campaignName || creating}
              >
                {creating ? 'Creating…' : 'Create Campaign'}
              </button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
