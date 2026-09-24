import { useRef, useState } from 'react';
import { Button } from '../components/Button/Button.tsx';
import { useCharacter } from './CharacterContext.tsx';
import {
  BACKGROUNDS, STAT_NAMES, CLASS_SAVING_THROWS, CLASS_ATTRIBUTE_ADVICE,
  BACKGROUND_ASI, BACKGROUND_FEAT,
  ORIGIN_FEATS, ORIGIN_FEAT_DETAILS,
  type StatName,
} from './srd.ts';
import SkillPicker from './SkillPicker.tsx';

function roll4d6k3(): number {
  const dice = Array.from({ length: 4 }, () => Math.ceil(Math.random() * 6));
  dice.sort((a, b) => a - b);
  return dice.slice(1).reduce((s, n) => s + n, 0);
}

function rollAll(): number[] {
  return Array.from({ length: 6 }, roll4d6k3);
}

function modifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

type DragSrc = { from: 'pool'; idx: number } | { from: 'stat'; idx: number };

const ASI_TOTAL = 3;
const ASI_MAX_PER_STAT = 2;

export default function AttributesTab() {
  const c = useCharacter();
  const drag = useRef<DragSrc | null>(null);
  const [dragOverStat, setDragOverStat] = useState<number | null>(null);
  const [dragOverPool, setDragOverPool] = useState(false);
  const [featOpen, setFeatOpen] = useState(false);

  // ── stat roller ────────────────────────────────────────────────────────────
  function handleRoll() {
    if (c.rolled && c.rerollUsed) return;
    c.set('pool', rollAll());
    c.set('stats', [0, 0, 0, 0, 0, 0]);
    if (c.rolled) c.set('rerollUsed', true);
    else c.set('rolled', true);
  }

  function dropOnStat(statIdx: number) {
    const src = drag.current;
    drag.current = null;
    setDragOverStat(null);
    if (!src) return;
    const stats = [...c.stats];
    const pool = [...c.pool];
    if (src.from === 'pool') {
      const incoming = pool[src.idx]!;
      const evicted = stats[statIdx] ?? 0;
      stats[statIdx] = incoming;
      pool.splice(src.idx, 1);
      if (evicted > 0) pool.push(evicted);
    } else {
      const a = stats[src.idx] ?? 0;
      stats[src.idx] = stats[statIdx] ?? 0;
      stats[statIdx] = a;
    }
    c.set('stats', stats);
    c.set('pool', pool);
  }

  function dropOnPool() {
    const src = drag.current;
    drag.current = null;
    setDragOverPool(false);
    if (!src || src.from !== 'stat') return;
    const val = c.stats[src.idx] ?? 0;
    if (val === 0) return;
    const stats = [...c.stats];
    stats[src.idx] = 0;
    c.set('stats', stats);
    c.set('pool', [...c.pool, val]);
  }

  // ── background ASI ─────────────────────────────────────────────────────────
  const asiStats: StatName[] = c.background ? (BACKGROUND_ASI[c.background] ?? []) : [];
  const asiTotal = asiStats.reduce((s, st) => s + (c.backgroundAsi[st] ?? 0), 0);
  const asiRemaining = ASI_TOTAL - asiTotal;

  function adjustAsi(stat: StatName, delta: number) {
    const current = c.backgroundAsi[stat] ?? 0;
    const next = current + delta;
    if (next < 0 || next > ASI_MAX_PER_STAT) return;
    if (delta > 0 && asiRemaining <= 0) return;
    c.set('backgroundAsi', { ...c.backgroundAsi, [stat]: next });
  }

  const bgFeatName = c.background ? BACKGROUND_FEAT[c.background] : undefined;
  const feat = bgFeatName ? ORIGIN_FEAT_DETAILS[bgFeatName] : undefined;
  const savingThrows = c.characterClass ? (CLASS_SAVING_THROWS[c.characterClass] ?? []) : [];

  return (
    <>
      {c.characterClass && CLASS_ATTRIBUTE_ADVICE[c.characterClass] && (
        <p className="attribute-advice">{CLASS_ATTRIBUTE_ADVICE[c.characterClass]}</p>
      )}

      {/* ── stat roller ── */}
      <div className="stat-block">
        <div className="stat-block-header">
          <span className="settings-section-title">Ability Scores</span>
          <Button variant="ghost" className="btn-roll" onClick={handleRoll} disabled={c.rerollUsed}>
            {!c.rolled ? 'Roll Stats' : c.rerollUsed ? 'Reroll used' : 'Reroll (1 left)'}
          </Button>
        </div>
        {c.rolled && (
          <div
            className={`pool-row ${dragOverPool ? 'pool-row--dragover' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOverPool(true); }}
            onDragLeave={() => setDragOverPool(false)}
            onDrop={dropOnPool}
          >
            {c.pool.length === 0
              ? <span className="pool-empty">All scores assigned</span>
              : c.pool.map((val, i) => (
                <div key={i} className="pool-chip" draggable onDragStart={() => { drag.current = { from: 'pool', idx: i }; }}>
                  {val}
                </div>
              ))
            }
          </div>
        )}
        <div className="stat-grid">
          {STAT_NAMES.map((name, i) => {
            const base = c.stats[i] ?? 0;
            const asiBonus = c.backgroundAsi[name] ?? 0;
            const effective = base + asiBonus;
            const assigned = base > 0;
            return (
              <div
                key={name}
                className={`stat-cell ${savingThrows.includes(name) ? 'stat-cell--saving' : ''} ${dragOverStat === i ? 'stat-cell--dragover' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOverStat(i); }}
                onDragLeave={() => setDragOverStat(null)}
                onDrop={() => dropOnStat(i)}
              >
                <span className="stat-label">{name}</span>
                <span className="stat-value-row">
                  {assigned
                    ? <>
                        <span className="stat-value stat-value--assigned" draggable onDragStart={() => { drag.current = { from: 'stat', idx: i }; }}>{base}</span>
                        {asiBonus > 0 && <span className="stat-asi-overlay">({effective})</span>}
                      </>
                    : <span className="stat-value stat-value--empty">—</span>
                  }
                </span>
                <span className="stat-mod">{assigned ? modifier(effective) : ''}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── background ── */}
      <div className="select-section">
        <label className="modal-label">
          Background
          <select className="modal-select" value={c.background} onChange={e => { c.set('background', e.target.value); c.set('backgroundAsi', {}); }}>
            <option value="">Select background…</option>
            {BACKGROUNDS.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>

        {c.background && (
          <div className="asi-block">
            <div className="asi-header">
              <span className="asi-label">Ability Score Improvements</span>
              <span className={`asi-remaining ${asiRemaining === 0 ? 'asi-remaining--done' : ''}`}>
                {asiRemaining} point{asiRemaining !== 1 ? 's' : ''} remaining
              </span>
            </div>
            <div className="asi-row">
              {asiStats.map(stat => {
                const val = c.backgroundAsi[stat] ?? 0;
                return (
                  <div key={stat} className="asi-stat">
                    <span className="asi-stat-name">{stat}</span>
                    <div className="asi-controls">
                      <Button variant="ghost" className="asi-btn" onClick={() => adjustAsi(stat, -1)} disabled={val === 0}>−</Button>
                      <span className="asi-value">{val > 0 ? `+${val}` : '0'}</span>
                      <Button variant="ghost" className="asi-btn" onClick={() => adjustAsi(stat, 1)} disabled={val >= ASI_MAX_PER_STAT || asiRemaining === 0}>+</Button>
                    </div>
                  </div>
                );
              })}
            </div>
            {feat && (
              <div className="feat-block">
                <Button variant="ghost" className={`feature-toggle feat-toggle ${featOpen ? 'feature-toggle--open' : ''}`} onClick={() => setFeatOpen(o => !o)}>
                  <span className="feature-name">Origin Feat: {feat.name}</span>
                  <span className="feature-arrow">{featOpen ? '▲' : '▼'}</span>
                </Button>
                {featOpen && <p className="feature-desc feat-desc">{feat.description}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── species-granted origin feat (Human: Versatile) ── */}
      {c.species === 'Human' && (
        <div className="select-section">
          <label className="modal-label modal-label--sub">
            Versatile — Origin Feat
            <select className="modal-select" value={c.speciesOriginFeat} onChange={e => c.set('speciesOriginFeat', e.target.value)}>
              <option value="">Select origin feat…</option>
              {ORIGIN_FEATS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            {c.speciesOriginFeat && ORIGIN_FEAT_DETAILS[c.speciesOriginFeat] && (
              <p className="origin-feat-desc">{ORIGIN_FEAT_DETAILS[c.speciesOriginFeat]!.description}</p>
            )}
          </label>
        </div>
      )}

      {/* ── skills ── */}
      <SkillPicker />
    </>
  );
}
