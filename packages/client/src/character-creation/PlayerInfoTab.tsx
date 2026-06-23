import { useRef, useState, useCallback } from 'react';
import { useCharacter } from './CharacterContext.tsx';
import {
  SPECIES, BACKGROUNDS, CLASSES, STAT_NAMES, CLASS_SAVING_THROWS,
  SPECIES_SUBSPECIES, BACKGROUND_ASI, BACKGROUND_FEAT,
  ORIGIN_FEATS, ORIGIN_FEAT_DETAILS,
  type StatName,
} from './srd.ts';
import CharacterSheet from './CharacterSheet.tsx';
import SkillPicker from './SkillPicker.tsx';

const API = `http://${window.location.hostname}:3001`;

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

export default function PlayerInfoTab({ campaignId }: { campaignId: string }) {
  const c = useCharacter();
  const drag = useRef<DragSrc | null>(null);
  const [dragOverStat, setDragOverStat] = useState<number | null>(null);
  const [dragOverPool, setDragOverPool] = useState(false);
  const [featOpen, setFeatOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError('');
    const reader = new FileReader();
    reader.onload = async e => {
      const dataUrl = e.target?.result as string;
      const base64image = dataUrl.split(',')[1] ?? '';
      c.set('portraitBase64', base64image);
      try {
        const r = await fetch(`${API}/api/campaigns/${campaignId}/party/portrait`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ charId: c.id, base64image }),
        });
        const data = await r.json() as { portraitPath?: string; tokenPath?: string; error?: string };
        if (data.error) throw new Error(data.error);
        c.set('portraitPath', data.portraitPath ?? '');
        c.set('tokenPath', data.tokenPath ?? '');
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }, [campaignId, c]);

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

  const feat = c.background ? BACKGROUND_FEAT[c.background] : undefined;
  const subspecies = SPECIES_SUBSPECIES[c.species] ?? [];
  const savingThrows = c.characterClass ? (CLASS_SAVING_THROWS[c.characterClass] ?? []) : [];

  return (
    <div className="player-info-layout">
      <div className="tab-content">

        {/* ── portrait + name (top) ── */}
        <div className="portrait-name-row">
          <div
            className={`inline-portrait-drop inline-portrait-drop--compact ${uploading ? 'inline-portrait-drop--loading' : ''}`}
            onClick={() => !uploading && fileInputRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !uploading) void processImage(f); }}
          >
            {c.portraitBase64
              ? <img src={`data:image/jpeg;base64,${c.portraitBase64}`} className="inline-portrait-preview" alt="Portrait" />
              : <span className="portrait-upload-hint">{uploading ? 'Processing…' : '+ Photo'}</span>
            }
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="portrait-file-input"
              onChange={e => { const f = e.target.files?.[0]; if (f) void processImage(f); }}
            />
          </div>

          <div className="portrait-name-fields">
            <label className="modal-label">
              Character Name
              <input className="modal-input" value={c.name} onChange={e => c.set('name', e.target.value)} placeholder="Enter character name…" />
            </label>
            <label className="modal-label">
              Join Password
              <input className="modal-input" type="password" value={c.password} onChange={e => c.set('password', e.target.value)} placeholder="Choose a password to join as this character" />
            </label>
            {uploadError && <p className="modal-error">{uploadError}</p>}
            {c.tokenPath && (
              <div className="inline-token-badge">
                <img src={`${API}/api/campaigns/${campaignId}/party/${c.id}/token`} className="inline-token-img" alt="Token" />
                <span className="portrait-result-label">Token ready</span>
              </div>
            )}
          </div>
        </div>

        {/* ── stat roller ── */}
        <div className="stat-block">
          <div className="stat-block-header">
            <span className="settings-section-title">Ability Scores</span>
            <button className="btn-roll" onClick={handleRoll} disabled={c.rerollUsed}>
              {!c.rolled ? 'Roll Stats' : c.rerollUsed ? 'Reroll used' : 'Reroll (1 left)'}
            </button>
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

        {/* ── species ── */}
        <div className="select-section">
          <label className="modal-label">
            Species
            <select className="modal-select" value={c.species} onChange={e => { c.set('species', e.target.value); c.set('subspecies', ''); c.set('speciesOriginFeat', ''); }}>
              <option value="">Select species…</option>
              {SPECIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {subspecies.length > 0 && (
            <label className="modal-label modal-label--sub">
              Lineage
              <select className="modal-select" value={c.subspecies} onChange={e => c.set('subspecies', e.target.value)}>
                <option value="">Select lineage…</option>
                {subspecies.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          )}
          {c.species === 'Human' && (
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
          )}
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
                        <button className="asi-btn" onClick={() => adjustAsi(stat, -1)} disabled={val === 0}>−</button>
                        <span className="asi-value">{val > 0 ? `+${val}` : '0'}</span>
                        <button className="asi-btn" onClick={() => adjustAsi(stat, 1)} disabled={val >= ASI_MAX_PER_STAT || asiRemaining === 0}>+</button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {feat && (
                <div className="feat-block">
                  <button className={`feature-toggle feat-toggle ${featOpen ? 'feature-toggle--open' : ''}`} onClick={() => setFeatOpen(o => !o)}>
                    <span className="feature-name">Origin Feat: {feat.name}</span>
                    <span className="feature-arrow">{featOpen ? '▲' : '▼'}</span>
                  </button>
                  {featOpen && <p className="feature-desc feat-desc">{feat.description}</p>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── class ── */}
        <div className="select-section">
          <label className="modal-label">
            Class
            <select className="modal-select" value={c.characterClass} onChange={e => { c.set('characterClass', e.target.value); c.set('skillProficiencies', {}); }}>
              <option value="">Select class…</option>
              {CLASSES.map(cl => <option key={cl} value={cl}>{cl}</option>)}
            </select>
          </label>
        </div>

        {/* ── skills ── */}
        <SkillPicker />

      </div>
      <CharacterSheet />
    </div>
  );
}
