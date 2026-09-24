import { useEffect, useRef } from 'react';
import { Button } from './components/Button/Button.tsx';
import { useCombatLogEntries, CombatLogEntries } from './combatLogEntries.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Plain-text lines (kind: 'text') only land in the log while this is on — the structured attack/spell cards always do. */
  showText: boolean;
}

export default function CombatLogOverlay({ open, onClose, showText }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = useCombatLogEntries(showText);

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
          <Button variant="outline" color="secondary" className="sheet-close" onClick={onClose} aria-label="Close">×</Button>
        </div>

        <div className="journal-messages combat-log-messages" ref={scrollRef}>
          {entries.length === 0 ? (
            <div className="journal-empty">
              <p className="journal-empty-text">No log entries yet.</p>
              <p className="journal-empty-hint">Entries appear when combat begins.</p>
            </div>
          ) : (
            <CombatLogEntries entries={entries} />
          )}
        </div>
      </div>
    </div>
  );
}
