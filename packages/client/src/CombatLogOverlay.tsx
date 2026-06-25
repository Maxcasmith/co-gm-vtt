import { useEffect, useRef, useState } from 'react';
import type { CombatLogPayload } from './events.ts';
import { on } from './events.ts';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CombatLogOverlay({ open, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // ponytail: no persistence — logs reset on mount, intentionally session-only
  const [entries, setEntries] = useState<CombatLogPayload[]>([]);

  useEffect(() => {
    return on('vtt:combat:log', entry => {
      setEntries(prev => [...prev, entry]);
    });
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="journal-scrim">
      <div className="journal-panel combat-log-panel">
        <div className="journal-header">
          <h2 className="journal-title">Combat Log</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="journal-messages combat-log-messages" ref={scrollRef}>
          {entries.length === 0 ? (
            <div className="journal-empty">
              <p className="journal-empty-text">No log entries yet.</p>
              <p className="journal-empty-hint">Entries appear when combat begins.</p>
            </div>
          ) : (
            entries.map((entry, i) => (
              <div key={i} className="combat-log-entry">
                <span className="combat-log-time">
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className="combat-log-text">{entry.text}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
