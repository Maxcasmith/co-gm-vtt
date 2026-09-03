import { useState } from 'react';
import type { PlotHook } from 'shared';
import Paginated, { PageSizeSelect } from './Paginated.tsx';

const API = `http://${window.location.hostname}:3001`;

interface PlotHooksTabProps {
  password: string;
}

export default function PlotHooksTab({ password }: PlotHooksTabProps) {
  const [pageSize, setPageSize] = useState(10);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newText, setNewText] = useState('');
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Bumped on delete/save — refetches the current page in place. Bumped as `resetKey` (used as
  // Paginated's `key`) on create instead, which remounts it back to page 1, where a fresh hook lands.
  const [reloadKey, setReloadKey] = useState(0);
  const [resetKey, setResetKey] = useState(0);

  function fetchPage(page: number, pageSize: number) {
    return fetch(`${API}/api/admin/plot-hooks?page=${page}&pageSize=${pageSize}`, { headers: { 'x-admin-password': password } })
      .then(r => r.json() as Promise<{ items: PlotHook[]; total: number }>);
  }

  async function createHook() {
    if (!newText.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/admin/plot-hooks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ rawText: newText }),
      });
      if (!r.ok) { setError('Normalization failed — check the server log.'); return; }
      setNewText('');
      setResetKey(k => k + 1);
    } catch {
      setError('Normalization failed — check the server log.');
    } finally {
      setCreating(false);
    }
  }

  async function saveHook(id: string) {
    const rawText = drafts[id];
    if (!rawText?.trim() || savingId) return;
    setSavingId(id);
    setError('');
    try {
      const r = await fetch(`${API}/api/admin/plot-hooks/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ rawText }),
      });
      if (!r.ok) { setError('Re-normalization failed — check the server log.'); return; }
      setReloadKey(k => k + 1);
    } catch {
      setError('Re-normalization failed — check the server log.');
    } finally {
      setSavingId(null);
    }
  }

  async function deleteHook(id: string) {
    if (!window.confirm('Permanently delete this plot hook? This cannot be undone.')) return;
    const r = await fetch(`${API}/api/admin/plot-hooks/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-password': password },
    });
    if (r.ok) setReloadKey(k => k + 1);
  }

  function toggle(id: string, rawText: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); setDrafts(d => ({ ...d, [id]: d[id] ?? rawText })); }
      return next;
    });
  }

  return (
    <>
      <div className="admin-modules-header">
        <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">📜</span>Plot Hook Pool</h2>
        <PageSizeSelect value={pageSize} onChange={setPageSize} />
      </div>
      <p className="modal-hint plot-hook-intro">
        Write an arc as you'd tell it — the VDM normalizes it into a reusable skeleton, then picks and reflavors from this pool during play.
      </p>

      <div className="admin-table-card admin-table-card--form">
        <div className="modal-form">
          <label className="modal-label">
            New arc
            <textarea
              className="modal-textarea"
              rows={6}
              value={newText}
              onChange={e => setNewText(e.target.value)}
              placeholder="e.g. The party is sent with the kingsguard to protect a village from intruders. The kingsguard burn it down to blame the intruders..."
            />
          </label>
        </div>
        {error && <p className="admin-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn-primary" onClick={() => void createHook()} disabled={!newText.trim() || creating}>
            {creating ? 'Normalizing…' : 'Normalize & Save'}
          </button>
        </div>
      </div>

      <Paginated key={resetKey} fetchPage={fetchPage} pageSize={pageSize} reloadKey={reloadKey}>
        {hooks => hooks.length === 0 ? (
          <div className="admin-table-card"><p className="admin-empty">No plot hooks yet.</p></div>
        ) : (
          <div className="tiles-accordion">
            {hooks.map(hook => {
              const isOpen = expanded.has(hook.id);
              return (
                <div key={hook.id} className="tiles-accordion-item">
                  <div className="tiles-accordion-header">
                    <button className="tiles-accordion-toggle" onClick={() => toggle(hook.id, hook.rawText)} aria-expanded={isOpen}>
                      <span className="tiles-accordion-caret">{isOpen ? '▾' : '▸'}</span>
                      <span className="tiles-accordion-name">{hook.title}</span>
                      <span className="admin-module-counts">{hook.beats.length} beat{hook.beats.length === 1 ? '' : 's'} · {hook.usedIn.length} use{hook.usedIn.length === 1 ? '' : 's'}</span>
                    </button>
                    <button className="btn-danger tiles-accordion-delete" onClick={() => void deleteHook(hook.id)}>Delete</button>
                  </div>
                  {isOpen && (
                    <div className="tiles-accordion-body">
                      <div className="modal-form">
                        {hook.tags.length > 0 && (
                          <p className="modal-hint"><strong>Tags:</strong> {hook.tags.join(', ')}</p>
                        )}
                        {hook.structuralRequirements.length > 0 && (
                          <p className="modal-hint"><strong>Needs:</strong> {hook.structuralRequirements.join('; ')}</p>
                        )}
                        <ol className="plot-hook-beats">
                          {hook.beats.map(beat => <li key={beat.order}>{beat.function}</li>)}
                        </ol>
                        <label className="modal-label">
                          Raw text
                          <textarea
                            className="modal-textarea"
                            rows={6}
                            value={drafts[hook.id] ?? hook.rawText}
                            onChange={e => setDrafts(d => ({ ...d, [hook.id]: e.target.value }))}
                          />
                        </label>
                      </div>
                      <div className="modal-actions">
                        <button
                          className="btn-secondary"
                          onClick={() => void saveHook(hook.id)}
                          disabled={savingId === hook.id || (drafts[hook.id] ?? hook.rawText) === hook.rawText}
                        >
                          {savingId === hook.id ? 'Re-normalizing…' : 'Save & Re-normalize'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Paginated>
    </>
  );
}
