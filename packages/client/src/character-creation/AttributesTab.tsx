import { useRef, useState } from 'react';
import type { AttributeGenerationMethods } from 'shared';
import { Button } from '../components/Button/Button.tsx';
import { useCharacter, type AttributeMethod } from './CharacterContext.tsx';
import { useAppMeta } from '../AppMetaContext.tsx';
import {
  playable, STAT_NAMES, CLASS_SAVING_THROWS, CLASS_ATTRIBUTE_ADVICE,
  BACKGROUND_ASI, BACKGROUND_FEAT,
  ORIGIN_FEAT_DETAILS,
  POINT_BUY_BUDGET, POINT_BUY_MIN, POINT_BUY_MAX, POINT_BUY_COSTS,
  type StatName,
} from './srd.ts';
import SkillPicker from './SkillPicker.tsx';

const METHOD_LABEL: Record<AttributeMethod, string> = {
  roll: 'Dice Roll',
  pointBuy: 'Point Buy',
  standardArray: 'Standard Array',
};

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

interface Props { attributeMethods: AttributeGenerationMethods }

export default function AttributesTab({ attributeMethods }: Props) {
  const c = useCharacter();
  const { backgrounds } = playable(useAppMeta().srdOnly);
  const drag = useRef<DragSrc | null>(null);
  const [dragOverStat, setDragOverStat] = useState<number | null>(null);
  const [dragOverPool, setDragOverPool] = useState(false);
  const [featOpen, setFeatOpen] = useState(false);

  const enabledMethods = (['roll', 'pointBuy', 'standardArray'] as const).filter(m =>
    m === 'roll' ? attributeMethods.diceRoll : m === 'pointBuy' ? attributeMethods.pointBuy : attributeMethods.standardArray,
  );

  // ── stat roller (Dice Roll) ─────────────────────────────────────────────────
  function handleRoll() {
    if (c.rolled && c.rerollUsed) return;
    c.set('pool', rollAll());
    c.set('stats', [0, 0, 0, 0, 0, 0]);
    if (c.rolled) c.set('rerollUsed', true);
    else c.set('rolled', true);
  }

  // Shared drag/drop assignment for Dice Roll and Standard Array — both are "pool of fixed
  // values dragged onto stat slots", just with a different pool source.
  const statsKey = c.attributeMethod === 'standardArray' ? 'standardArrayStats' : 'stats';
  const poolKey = c.attributeMethod === 'standardArray' ? 'standardArrayPool' : 'pool';
  const activePool = c[poolKey];

  function dropOnStat(statIdx: number) {
    const src = drag.current;
    drag.current = null;
    setDragOverStat(null);
    if (!src) return;
    const stats = [...c[statsKey]];
    const pool = [...c[poolKey]];
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
    c.set(statsKey, stats);
    c.set(poolKey, pool);
  }

  function dropOnPool() {
    const src = drag.current;
    drag.current = null;
    setDragOverPool(false);
    if (!src || src.from !== 'stat') return;
    const val = c[statsKey][src.idx] ?? 0;
    if (val === 0) return;
    const stats = [...c[statsKey]];
    stats[src.idx] = 0;
    c.set(statsKey, stats);
    c.set(poolKey, [...c[poolKey], val]);
  }

  // ── point buy ────────────────────────────────────────────────────────────────
  const pointBuySpent = c.pointBuyStats.reduce((sum, score) => sum + (POINT_BUY_COSTS[score] ?? 0), 0);
  const pointBuyRemaining = POINT_BUY_BUDGET - pointBuySpent;

  function adjustPointBuy(statIdx: number, delta: number) {
    const current = c.pointBuyStats[statIdx] ?? POINT_BUY_MIN;
    const next = current + delta;
    if (next < POINT_BUY_MIN || next > POINT_BUY_MAX) return;
    const cost = (POINT_BUY_COSTS[next] ?? 0) - (POINT_BUY_COSTS[current] ?? 0);
    if (cost > pointBuyRemaining) return;
    const stats = [...c.pointBuyStats];
    stats[statIdx] = next;
    c.set('pointBuyStats', stats);
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
  const savingThrows: StatName[] = c.characterClass ? (CLASS_SAVING_THROWS[c.characterClass] ?? []) : [];

  return (
    <>
      {c.characterClass && CLASS_ATTRIBUTE_ADVICE[c.characterClass] && (
        <p className="attribute-advice">{CLASS_ATTRIBUTE_ADVICE[c.characterClass]}</p>
      )}

      {/* ── ability scores ── */}
      <div className="stat-block">
        <div className="stat-block-header">
          <span className="settings-section-title">Ability Scores</span>
          {c.attributeMethod === 'roll' && (
            <Button variant="ghost" className="btn-roll" onClick={handleRoll} disabled={c.rerollUsed}>
              {!c.rolled ? 'Roll Stats' : c.rerollUsed ? 'Reroll used' : 'Reroll (1 left)'}
            </Button>
          )}
          {c.attributeMethod === 'pointBuy' && (
            <span className={`asi-remaining ${pointBuyRemaining === 0 ? 'asi-remaining--done' : ''}`}>
              {pointBuyRemaining} point{pointBuyRemaining !== 1 ? 's' : ''} remaining
            </span>
          )}
        </div>

        {enabledMethods.length > 1 && (
          <div className="attr-method-tabs">
            {enabledMethods.map(m => (
              <Button
                key={m}
                variant="ghost"
                className={`attr-method-tab ${c.attributeMethod === m ? 'attr-method-tab--active' : ''}`}
                onClick={() => c.set('attributeMethod', m)}
              >
                {METHOD_LABEL[m]}
              </Button>
            ))}
          </div>
        )}

        {c.attributeMethod === 'pointBuy' ? (
          <div className="point-buy-grid">
            {STAT_NAMES.map((name, i) => {
              const base = c.pointBuyStats[i] ?? POINT_BUY_MIN;
              const asiBonus = c.backgroundAsi[name] ?? 0;
              const effective = base + asiBonus;
              return (
                <div key={name} className={`point-buy-row ${savingThrows.includes(name) ? 'stat-cell--saving' : ''}`}>
                  <span className="stat-label">{name}</span>
                  <div className="asi-controls">
                    <Button variant="ghost" className="asi-btn" onClick={() => adjustPointBuy(i, -1)} disabled={base <= POINT_BUY_MIN}>−</Button>
                    <span className="stat-value stat-value--assigned">{base}</span>
                    <Button variant="ghost" className="asi-btn" onClick={() => adjustPointBuy(i, 1)} disabled={base >= POINT_BUY_MAX || pointBuyRemaining <= 0}>+</Button>
                  </div>
                  {asiBonus > 0 && <span className="stat-asi-overlay">({effective})</span>}
                  <span className="stat-mod">{modifier(effective)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            {(c.attributeMethod === 'standardArray' || c.rolled) && (
              <div
                className={`pool-row ${dragOverPool ? 'pool-row--dragover' : ''}`}
                onDragOver={e => { e.preventDefault(); setDragOverPool(true); }}
                onDragLeave={() => setDragOverPool(false)}
                onDrop={dropOnPool}
              >
                {activePool.length === 0
                  ? <span className="pool-empty">All scores assigned</span>
                  : activePool.map((val, i) => (
                    <div key={i} className="pool-chip" draggable onDragStart={() => { drag.current = { from: 'pool', idx: i }; }}>
                      {val}
                    </div>
                  ))
                }
              </div>
            )}
            <div className="stat-grid">
              {STAT_NAMES.map((name, i) => {
                const base = c[statsKey][i] ?? 0;
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
          </>
        )}
      </div>

      {/* ── background ── */}
      <div className="select-section">
        <label className="modal-label">
          Background
          <select className="modal-select" value={c.background} onChange={e => { c.set('background', e.target.value); c.set('backgroundAsi', {}); }}>
            <option value="">Select background…</option>
            {backgrounds.map(b => <option key={b} value={b}>{b}</option>)}
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

      {/* ── skills ── */}
      <SkillPicker />
    </>
  );
}
