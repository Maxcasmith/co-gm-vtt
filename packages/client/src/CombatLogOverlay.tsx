import { useEffect, useRef, useState } from 'react';
import type { CombatLogPayload } from './events.ts';
import { on } from './events.ts';

interface Props {
  open: boolean;
  onClose: () => void;
}

function fmtBonus(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

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
    return on('vtt:combat:attack:result', result => {
      setEntries(prev => [...prev, {
        kind: 'attack',
        timestamp: Date.now(),
        attackerName: result.attackerName,
        weaponName: result.weaponName,
        d20: result.d20,
        statBonus: result.statBonus,
        statName: result.statName,
        weaponBonus: result.weaponBonus,
        total: result.total,
        ac: result.ac,
        hit: result.hit,
        damage: result.damage,
        damageRoll: result.damageRoll,
        damageType: result.damageType,
        damageFormula: result.damageFormula,
        targetName: result.targetName,
      }]);
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
            entries.map((entry, i) => {
              if (entry.kind === 'attack') {
                return (
                  <div key={i} className="combat-log-entry combat-log-entry--attack">
                    <span className="combat-log-time">
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <div className="combat-log-attack-card">
                      <div className="combat-log-attack-header">
                        <span className="combat-log-attack-action">{entry.attackerName} — {entry.weaponName}</span>
                        <span className={`combat-log-attack-total ${entry.hit ? 'combat-log-attack-total--hit' : 'combat-log-attack-total--miss'}`}>
                          {entry.total}
                        </span>
                      </div>

                      <div className="combat-log-attack-breakdown">
                        <div className="combat-log-breakdown-row">
                          <span>Dice roll (d20)</span>
                          <span className="combat-log-breakdown-box">{entry.d20}</span>
                        </div>
                        <div className="combat-log-breakdown-row">
                          <span>{entry.statName} bonus</span>
                          <span className="combat-log-breakdown-box">{fmtBonus(entry.statBonus)}</span>
                        </div>
                        {entry.weaponBonus !== 0 && (
                          <div className="combat-log-breakdown-row">
                            <span>Weapon bonus</span>
                            <span className="combat-log-breakdown-box">{fmtBonus(entry.weaponBonus)}</span>
                          </div>
                        )}

                        <div className="combat-log-attack-vs">
                          <span>vs. {entry.targetName}</span>
                          <span>AC {entry.ac}</span>
                        </div>
                      </div>

                      {entry.hit && entry.damage != null && entry.damageRoll != null ? (
                        <div className="combat-log-damage-section">
                          <div className="combat-log-damage-total">
                            {entry.damage} {entry.damageType ?? 'damage'}
                          </div>
                          <div className="combat-log-attack-breakdown combat-log-attack-breakdown--damage">
                            <div className="combat-log-breakdown-row">
                              <span>{entry.weaponName} ({entry.damageFormula ?? 'die'})</span>
                              <span className="combat-log-breakdown-box">{entry.damageRoll}</span>
                            </div>
                            {entry.statBonus !== 0 && (
                              <div className="combat-log-breakdown-row">
                                <span>{entry.statName} bonus</span>
                                <span className="combat-log-breakdown-box">{fmtBonus(entry.statBonus)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : !entry.hit ? (
                        <div className="combat-log-attack-miss">Miss</div>
                      ) : null}
                    </div>
                  </div>
                );
              }
              return (
                <div key={i} className="combat-log-entry">
                  <span className="combat-log-time">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="combat-log-text">{entry.text}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
