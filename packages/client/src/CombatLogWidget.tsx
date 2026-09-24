import { useEffect, useRef } from 'react';
import { useCombatLogEntries, CombatLogEntries } from './combatLogEntries.tsx';

interface Props {
  open: boolean;
  showText: boolean;
}

export default function CombatLogWidget({ open, showText }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = useCombatLogEntries(showText);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, open]);

  if (!open) return null;

  return (
    <div className="combat-log-widget">
      <div className="combat-log-widget-header">Combat Log</div>
      <div className="combat-log-widget-messages" ref={scrollRef}>
        {entries.length === 0 ? (
          <div className="combat-log-widget-empty">No log entries yet.</div>
        ) : (
          <CombatLogEntries entries={entries} />
        )}
      </div>
    </div>
  );
}
