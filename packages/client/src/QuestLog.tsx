import { useEffect, useState } from 'react';
import type { Quest } from 'shared';

interface Props {
  open: boolean;
  onClose: () => void;
  quests: Quest[];
  act: number;
}

export default function QuestLog({ open, onClose, quests, act }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const visible = quests.filter(q => q.status !== 'undiscovered');

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="journal-scrim">
      <div className="journal-panel">
        <div className="journal-header">
          <h2 className="journal-title">Quest Log</h2>
          <div className="quest-header-right">
            <span className="quest-act-badge">Act {act}</span>
            <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        </div>

        <div className="journal-messages">
          {visible.length === 0 ? (
            <div className="journal-empty">
              <p className="journal-empty-text">No quests yet — the story is just beginning.</p>
            </div>
          ) : (
            visible.map(quest => (
              <div key={quest.id} className={`quest-item quest-item--${quest.status}`}>
                <button className="quest-header-btn" onClick={() => toggle(quest.id)}>
                  <span className={`quest-dot quest-dot--${quest.status}`} />
                  <span className="quest-name">{quest.name}</span>
                  <span className="quest-chevron">{expanded.has(quest.id) ? '▲' : '▼'}</span>
                </button>
                {expanded.has(quest.id) && (
                  <div className="quest-detail">
                    <p className="quest-description">{quest.description}</p>
                    {quest.log.length > 0 && (
                      <ul className="quest-log-entries">
                        {quest.log.map((entry, i) => (
                          <li key={i} className="quest-log-entry">
                            <span className="quest-log-date">{entry.date}</span>
                            {entry.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
