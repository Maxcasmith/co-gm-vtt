import { useState } from 'react';
import { iconSlug } from 'shared';
import ItemIcon from './ItemIcon.tsx';

export interface DetailSubject {
  name: string;
  description: string;
  iconPath?: string;
  // Everything else about the underlying ShopItem/AbilityDef, dumped generically below — read-only,
  // this app's items/abilities live in srd.ts/abilities.ts, not a database, so there's no field to
  // write an edit back to. Only the icon is actually backed by real storage (storage/icons/), so
  // it's the one thing this sidebar can genuinely change.
  raw: Record<string, unknown>;
}

interface Props {
  subject: DetailSubject | null;
  password: string;
  onClose: () => void;
  onIconChanged: () => void;
}

const API = `http://${window.location.hostname}:3001`;
const HIDDEN_KEYS = new Set(['name', 'label', 'description', 'iconPath', 'id', 'key']);

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(v => (v && typeof v === 'object') ? JSON.stringify(v) : String(v)).join(', ') : '—';
  if (value && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function ItemDetailSidebar({ subject, password, onClose, onIconChanged }: Props) {
  const [busy, setBusy] = useState(false);

  async function generateIcon() {
    if (!subject) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/admin/icons/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
        body: JSON.stringify({ items: [{ name: subject.name, description: subject.description }] }),
      });
      // Single item — just drain the SSE stream to completion, no progress log needed here.
      if (res.body) {
        const reader = res.body.getReader();
        while (!(await reader.read()).done) { /* drain */ }
      }
      onIconChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeIcon() {
    if (!subject) return;
    setBusy(true);
    try {
      await fetch(`${API}/api/admin/icons/${iconSlug(subject.name)}`, { method: 'DELETE', headers: { 'x-admin-password': password } });
      onIconChanged();
    } finally {
      setBusy(false);
    }
  }

  const open = !!subject;
  const fields = subject ? Object.entries(subject.raw).filter(([k, v]) => !HIDDEN_KEYS.has(k) && v !== undefined) : [];

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`item-detail-sidebar ${open ? 'item-detail-sidebar--open' : ''}`}>
        {subject && (
          <>
            <div className="item-detail-sidebar-header">
              <button className="sheet-close item-detail-sidebar-close" onClick={onClose} aria-label="Close">×</button>
              <ItemIcon className="item-detail-sidebar-icon" name={subject.name} iconPath={subject.iconPath} />
              <h2 className="settings-title">{subject.name}</h2>
            </div>

            <div className="item-detail-sidebar-body">
              <p className="modal-hint">{subject.description}</p>

              <div className="item-detail-icon-controls">
                {subject.iconPath ? (
                  <p className="admin-empty">Bundled icon — fixed in code, can't be changed here.</p>
                ) : (
                  <>
                    <button className="btn-secondary" onClick={() => void generateIcon()} disabled={busy}>
                      {busy ? 'Working…' : 'Generate / Regenerate Icon'}
                    </button>
                    <button className="btn-secondary" onClick={() => void removeIcon()} disabled={busy}>
                      Remove Icon
                    </button>
                  </>
                )}
              </div>

              <div className="item-detail-fields">
                {fields.map(([k, v]) => (
                  <div key={k} className="item-detail-row">
                    <span className="item-detail-row-label">{k}</span>
                    <span className="item-detail-row-value">{formatValue(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
