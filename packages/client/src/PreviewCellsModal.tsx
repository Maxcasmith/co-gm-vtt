import { useEffect, useState } from 'react';
import { Button } from './components/Button/Button.tsx';

interface Props {
  file: string | null;
  password: string;
  onClose: () => void;
}

const API = `http://${window.location.hostname}:3001`;

export default function PreviewCellsModal({ file, password, onClose }: Props) {
  const [cells, setCells] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!file) return;
    setLoading(true);
    setError('');
    setCells([]);
    fetch(`${API}/api/admin/props/preview-cells/${file}`, { headers: { 'x-admin-password': password } })
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Preview failed');
        return r.json() as Promise<{ cells: string[] }>;
      })
      .then(data => setCells(data.cells))
      .catch(err => setError(err instanceof Error ? err.message : 'Preview failed'))
      .finally(() => setLoading(false));
  }, [file, password]);

  if (!file) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <dialog className="modal super-modal" open onClick={e => e.stopPropagation()}>
        <Button variant="outline" color="secondary" className="sheet-close campaign-modal-close" onClick={onClose} aria-label="Close">×</Button>
        <h2 className="modal-title">Cell Preview</h2>

        <div className="super-modal-body">
          <p className="modal-hint">
            Runs the real crop/grid-detection code against this source atlas — no AI call. Shows exactly what
            each detected cell would be saved as.
          </p>

          {loading && <p className="modal-hint">Detecting grid and cropping…</p>}
          {error && <p className="modal-error">{error}</p>}

          {!loading && !error && (
            <div className="tile-grid">
              {cells.map((src, i) => (
                <div key={i} className="tile-card">
                  <img src={src} alt={`Cell ${i + 1}`} className="tile-img tile-img--contain" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <Button onClick={onClose}>Close</Button>
        </div>
      </dialog>
    </div>
  );
}
