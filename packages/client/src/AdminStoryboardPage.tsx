import { useEffect, useState } from 'react';
import type { StoryboardTestRecord, StoryboardQueuePayload } from 'shared';
import { Button } from './components/Button/Button.tsx';
import AdminPageShell from './AdminPageShell.tsx';
import StoryboardTestModal from './StoryboardTestModal.tsx';
import StoryboardOverlay from './StoryboardOverlay.tsx';

const API = `http://${window.location.hostname}:3001`;

interface Props {
  password: string;
  onHome: () => void;
}

export default function AdminStoryboardPage({ password, onHome }: Props) {
  const [storyboardRecord, setStoryboardRecord] = useState<StoryboardTestRecord | null>(null);
  const [storyboardTestOpen, setStoryboardTestOpen] = useState(false);
  const [storyboardPlaying, setStoryboardPlaying] = useState(false);
  const [storyboardEraseConfirm, setStoryboardEraseConfirm] = useState(false);
  const [storyboardErasing, setStoryboardErasing] = useState(false);

  function fetchStoryboardRecord() {
    fetch(`${API}/api/admin/storyboard-test`, { headers: { 'x-admin-password': password } })
      .then(r => r.json())
      .then((data: { record: StoryboardTestRecord | null }) => setStoryboardRecord(data.record))
      .catch(() => {});
  }

  useEffect(() => { fetchStoryboardRecord(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirmEraseStoryboard() {
    setStoryboardErasing(true);
    try {
      const r = await fetch(`${API}/api/admin/storyboard-test`, {
        method: 'DELETE',
        headers: { 'x-admin-password': password },
      });
      if (r.ok) {
        setStoryboardRecord(null);
        setStoryboardEraseConfirm(false);
      }
    } finally {
      setStoryboardErasing(false);
    }
  }

  return (
    <>
    <AdminPageShell title="Storyboard" onHome={onHome}>
      <div className="admin-modules-header">
        <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">🎬</span>Character Storyboard</h2>
        <Button onClick={() => setStoryboardTestOpen(true)}>+ Test Storyboard</Button>
      </div>

      {!storyboardRecord && (
        <div className="admin-table-card"><p className="admin-empty">No storyboard generated yet.</p></div>
      )}

      {storyboardRecord && (
        <div className="admin-table-card admin-table-card--form">
          <div className="admin-modules-header">
            <h3 className="tiles-accordion-name">{storyboardRecord.name}</h3>
            <div className="admin-modules-header-actions">
              <Button variant="outline" onClick={() => setStoryboardPlaying(true)}>▶ Play</Button>
              <Button variant="outline" color="danger" onClick={() => setStoryboardEraseConfirm(true)}>Erase</Button>
            </div>
          </div>
          {storyboardRecord.sourceUrl && (
            <div className="tile-grid">
              <div className="tile-source">
                <img
                  src={`${API}${storyboardRecord.sourceUrl}`}
                  alt="Storyboard source atlas"
                  title="Unmodified atlas straight from the model, before crop/resize"
                  className="tile-source-img"
                />
                <span className="tile-label">Source Atlas (unmodified, before crop)</span>
              </div>
            </div>
          )}
          <div className="tile-grid">
            {storyboardRecord.slides.map((slide, i) => (
              <div key={slide.url} className="tile-card">
                <img src={`${API}${slide.url}`} alt={`Slide ${i + 1}`} title={slide.caption} className="tile-img" />
                <span className="tile-label">Slide {i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </AdminPageShell>

    <StoryboardTestModal
      open={storyboardTestOpen}
      password={password}
      record={storyboardRecord}
      onClose={() => setStoryboardTestOpen(false)}
      onGenerated={record => setStoryboardRecord(record)}
    />

    {storyboardPlaying && storyboardRecord && (
      <StoryboardOverlay
        queue={{ entries: [{ characterId: 'storyboard-test', characterName: storyboardRecord.name, slides: storyboardRecord.slides }] } satisfies StoryboardQueuePayload}
        onDone={() => setStoryboardPlaying(false)}
      />
    )}

    {storyboardEraseConfirm && (
      <div className="modal-overlay" onClick={() => !storyboardErasing && setStoryboardEraseConfirm(false)}>
        <dialog className="modal" open onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="modal-title">Erase Storyboard</h2>
            <p className="modal-hint">
              Permanently erase the test storyboard for <strong>{storyboardRecord?.name}</strong>? This removes the portrait and all slides. This cannot be undone.
            </p>
          </div>
          <div className="modal-actions">
            <Button variant="outline" color="secondary" onClick={() => setStoryboardEraseConfirm(false)} disabled={storyboardErasing}>Cancel</Button>
            <Button variant="outline" color="danger" onClick={() => void confirmEraseStoryboard()} disabled={storyboardErasing}>
              {storyboardErasing ? 'Erasing…' : 'Erase'}
            </Button>
          </div>
        </dialog>
      </div>
    )}
    </>
  );
}
