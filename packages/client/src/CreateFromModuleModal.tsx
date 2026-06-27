import { useState } from 'react';
import type { CompendiumMeta } from 'shared';

interface Props {
  open: boolean;
  adventure: CompendiumMeta | null;
  onClose: () => void;
  onCreated: () => void;
}

const API = `http://${window.location.hostname}:3001`;

export default function CreateFromModuleModal({ open, adventure, onClose, onCreated }: Props) {
  const [campaignName, setCampaignName] = useState('');
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  function handleClose() {
    setCampaignName('');
    setCreating(false);
    setProgress('');
    setDone(false);
    setError('');
    onClose();
  }

  async function handleCreate() {
    if (!adventure || !campaignName) return;
    setCreating(true);
    setProgress('');
    setError('');
    setDone(false);

    try {
      const res = await fetch(`${API}/api/campaigns/from-module`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adventureSlug: adventure.slug, campaignName }),
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
            const evt = JSON.parse(line.slice(6)) as { type: string; message?: string; id?: string };
            if (evt.type === 'progress') {
              setProgress(p => p ? `${p}\n${evt.message}` : (evt.message ?? ''));
            } else if (evt.type === 'complete') {
              setDone(true);
              onCreated();
            } else if (evt.type === 'error') {
              setError(evt.message ?? 'Failed to create campaign');
            }
          } catch { /* skip malformed */ }
        }
      }
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
  ].filter(Boolean).join(', ');

  return (
    <div className="modal-overlay" onClick={done || creating ? undefined : handleClose}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">
            {done ? `${adventure.name} Campaign Ready` : `Create ${adventure.name} Campaign`}
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

        {(creating || done) && (
          <pre className="stream-output">{progress || 'Starting…'}</pre>
        )}

        {done && (
          <p className="modal-success">
            Campaign created. Your DM brief is ready — the Virtual DM knows where to start.
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
