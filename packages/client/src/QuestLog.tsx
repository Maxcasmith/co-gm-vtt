import { useEffect, useState } from 'react';
import type { Quest } from 'shared';
import { Button } from './components/Button/Button.tsx';

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

  // Quest descriptions come as either a single sentence (older/hardcoded quests) or several
  // "- " bullet lines (LLM-authored dungeon goals) — split into real list items only when there's
  // more than one, so a plain one-liner still renders as an ordinary paragraph.
  function descriptionBullets(description: string): string[] | null {
    const lines = description.split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean);
    return lines.length > 1 ? lines : null;
  }

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
            <Button variant="outline" color="secondary" className="sheet-close" onClick={onClose} aria-label="Close">×</Button>
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
                <Button variant="ghost" className="quest-header-btn" onClick={() => toggle(quest.id)}>
                  <span className={`quest-dot quest-dot--${quest.status}`} />
                  <span className="quest-name">{quest.name}</span>
                  <span className="quest-chevron">{expanded.has(quest.id) ? '▲' : '▼'}</span>
                </Button>
                {expanded.has(quest.id) && (
                  <div className="quest-detail">
                    {(() => {
                      const bullets = descriptionBullets(quest.description);
                      return bullets ? (
                        <ul className="quest-description-list">
                          {bullets.map((line, i) => <li key={i} className="quest-description-item">{line}</li>)}
                        </ul>
                      ) : (
                        <p className="quest-description">{quest.description}</p>
                      );
                    })()}
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
