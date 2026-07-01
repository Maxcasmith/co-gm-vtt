import { useEffect, useState, useMemo } from 'react';
import type { Spell } from 'shared';
import { useCharacter } from './CharacterContext.tsx';
import { CLASS_FEATURES, CLASS_SPELL_ALLOWANCE, FEAT_SPELL_GRANTS } from './srd.ts';
import CharacterSheet from './CharacterSheet.tsx';

const API = `http://${window.location.hostname}:3001`;

const LEVEL_LABELS: Record<number, string> = {
  0: 'Cantrip', 1: '1st', 2: '2nd', 3: '3rd', 4: '4th',
  5: '5th', 6: '6th', 7: '7th', 8: '8th', 9: '9th',
};

function SpellCard({ spell, onClick, selected }: { spell: Spell; onClick: () => void; selected: boolean }) {
  return (
    <button
      className={`spell-card ${selected ? 'spell-card--selected' : ''}`}
      onClick={onClick}
    >
      <div className="spell-card-header">
        <span className="spell-card-name">{spell.name}</span>
        <span className="spell-card-level">{spell.levelLabel}</span>
      </div>
      <div className="spell-card-meta">
        <span className="spell-card-school">{spell.school}{spell.isRitual ? ' · Ritual' : ''}</span>
        <span className="spell-card-cast">{spell.castingTime}</span>
      </div>
    </button>
  );
}

export default function SpellsTab() {
  const c = useCharacter();

  const isSpellcaster = c.characterClass
    ? (CLASS_FEATURES[c.characterClass] ?? []).some(f => f.name === 'Spellcasting' || f.name === 'Pact Magic')
    : false;

  const allowance = CLASS_SPELL_ALLOWANCE[c.characterClass] ?? null;
  const featGrant = FEAT_SPELL_GRANTS[c.speciesOriginFeat ?? ''] ?? null;

  const maxCantrips = (allowance?.cantrips ?? 0) + (featGrant?.cantrips ?? 0);
  const maxSpells   = (allowance?.spells  ?? 0) + (featGrant?.spells  ?? 0);

  const [allSpells, setAllSpells] = useState<Spell[]>([]);
  const [loading, setLoading]    = useState(false);
  const [filterLevel, setFilterLevel]   = useState<string>('all');
  const [filterSchool, setFilterSchool] = useState<string>('all');
  const [filterRitual, setFilterRitual] = useState<string>('all');
  const [search, setSearch]             = useState('');
  const [selected, setSelected]         = useState<Spell | null>(null);

  // Fetch spells for this class when the class is known
  useEffect(() => {
    if (!c.characterClass) return;
    setLoading(true);

    // Which classes to fetch: own class + any feat-granted class
    const classList = [c.characterClass];
    if (featGrant) classList.push(featGrant.forClass);
    const params = classList.map(cl => `class=${encodeURIComponent(cl)}`).join('&');

    fetch(`${API}/api/spells?${params}`)
      .then(r => r.json())
      .then((data: Spell[]) => setAllSpells(data))
      .catch(() => setAllSpells([]))
      .finally(() => setLoading(false));
  }, [c.characterClass, featGrant?.forClass]);

  const schools = useMemo(() => [...new Set(allSpells.map(s => s.school))].sort(), [allSpells]);

  const filtered = useMemo(() => {
    let list = allSpells;
    if (filterLevel !== 'all') list = list.filter(s => String(s.level) === filterLevel);
    if (filterSchool !== 'all') list = list.filter(s => s.school === filterSchool);
    if (filterRitual === 'ritual') list = list.filter(s => s.isRitual);
    if (filterRitual === 'non-ritual') list = list.filter(s => !s.isRitual);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    return list;
  }, [allSpells, filterLevel, filterSchool, filterRitual, search]);

  const learnedSet = new Set(c.learnedSpells);

  const learnedCantrips = c.learnedSpells.filter(name => allSpells.find(s => s.name === name && s.level === 0)).length;
  const learnedSpellCount = c.learnedSpells.filter(name => allSpells.find(s => s.name === name && s.level > 0)).length;

  function toggleLearn(spell: Spell) {
    const isCantrip = spell.level === 0;
    if (learnedSet.has(spell.name)) {
      c.set('learnedSpells', c.learnedSpells.filter(n => n !== spell.name));
    } else {
      const atLimit = isCantrip ? learnedCantrips >= maxCantrips : learnedSpellCount >= maxSpells;
      if (atLimit) return;
      c.set('learnedSpells', [...c.learnedSpells, spell.name]);
    }
  }

  if (!isSpellcaster && !featGrant) {
    return (
      <div className="player-info-layout">
        <div className="tab-content">
          <div className="spells-placeholder">
            <p className="spells-placeholder-title">No Spellcasting</p>
            <p className="spells-placeholder-body">
              {c.characterClass
                ? `${c.characterClass}s do not have the ability to cast spells.`
                : 'Select a class to see spellcasting information.'}
            </p>
          </div>
        </div>
        <CharacterSheet />
      </div>
    );
  }

  return (
    <div className="player-info-layout">
      <div className="tab-content spells-tab">

        {/* ── Section 1: Learned spells ── */}
        <section className="spells-section">
          <div className="spells-section-header">
            <h3 className="spells-section-title">Learned Spells</h3>
            <span className="spells-section-counts">
              {maxCantrips > 0 && <span className={learnedCantrips >= maxCantrips ? 'spells-count spells-count--full' : 'spells-count'}>{learnedCantrips}/{maxCantrips} cantrips</span>}
              {maxSpells > 0   && <span className={learnedSpellCount >= maxSpells ? 'spells-count spells-count--full' : 'spells-count'}>{learnedSpellCount}/{maxSpells} spells</span>}
            </span>
          </div>
          {c.learnedSpells.length === 0 ? (
            <p className="spells-empty">No spells learned yet — browse below and click Learn to add them.</p>
          ) : (
            <div className="spells-learned-list">
              {c.learnedSpells.map(name => {
                const spell = allSpells.find(s => s.name === name);
                if (!spell) return null;
                return (
                  <div key={name} className="spells-learned-chip">
                    <button className="spells-learned-name" onClick={() => setSelected(spell)}>{name}</button>
                    <span className="spells-learned-level">{spell.levelLabel}</span>
                    <button className="spells-learned-remove" onClick={() => toggleLearn(spell)} title="Forget">×</button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Section 2: Spell browser ── */}
        <section className="spells-section">
          <div className="spells-section-header">
            <h3 className="spells-section-title">Available Spells</h3>
          </div>

          <div className="spells-filters">
            <input
              className="spells-search"
              placeholder="Search spells…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className="spells-filter-select" value={filterLevel} onChange={e => setFilterLevel(e.target.value)}>
              <option value="all">All Levels</option>
              {[0,1,2,3,4,5,6,7,8,9].map(l => (
                <option key={l} value={String(l)}>{LEVEL_LABELS[l]}</option>
              ))}
            </select>
            <select className="spells-filter-select" value={filterSchool} onChange={e => setFilterSchool(e.target.value)}>
              <option value="all">All Schools</option>
              {schools.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="spells-filter-select" value={filterRitual} onChange={e => setFilterRitual(e.target.value)}>
              <option value="all">Ritual: Any</option>
              <option value="ritual">Ritual Only</option>
              <option value="non-ritual">Non-Ritual</option>
            </select>
          </div>

          {loading && <p className="spells-empty">Loading spells…</p>}
          {!loading && filtered.length === 0 && <p className="spells-empty">No spells match your filters.</p>}
          {!loading && filtered.length > 0 && (
            <div className="spells-browser-list">
              {filtered.map(spell => {
                const isCantrip = spell.level === 0;
                const learned = learnedSet.has(spell.name);
                const atLimit = isCantrip ? learnedCantrips >= maxCantrips : learnedSpellCount >= maxSpells;
                return (
                  <div key={spell.name} className={`spells-browser-row ${selected?.name === spell.name ? 'spells-browser-row--selected' : ''}`}>
                    <button className="spells-browser-info" onClick={() => setSelected(selected?.name === spell.name ? null : spell)}>
                      <span className="spells-browser-name">{spell.name}</span>
                      <span className="spells-browser-tags">
                        <span className="spells-tag">{spell.levelLabel}</span>
                        <span className="spells-tag">{spell.school}</span>
                        {spell.isRitual && <span className="spells-tag spells-tag--ritual">Ritual</span>}
                        <span className="spells-tag spells-tag--cast">{spell.castingTime}</span>
                      </span>
                    </button>
                    <button
                      className={`spells-learn-btn ${learned ? 'spells-learn-btn--learned' : ''}`}
                      onClick={() => toggleLearn(spell)}
                      disabled={!learned && atLimit}
                      title={learned ? 'Forget' : atLimit ? 'Limit reached' : 'Learn'}
                    >
                      {learned ? 'Forget' : 'Learn'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Section 3: Spell detail ── */}
        <section className="spells-section spells-detail-section">
          <div className="spells-section-header">
            <h3 className="spells-section-title">Spell Details</h3>
          </div>
          {!selected ? (
            <p className="spells-empty">Click a spell above to see its details.</p>
          ) : (
            <div className="spells-detail">
              <div className="spells-detail-header">
                <span className="spells-detail-name">{selected.name}</span>
                <span className="spells-detail-level">{selected.levelLabel} · {selected.school}{selected.isRitual ? ' (Ritual)' : ''}</span>
              </div>
              <dl className="spells-detail-stats">
                <dt>Casting Time</dt><dd>{selected.castingTime}</dd>
                <dt>Range</dt><dd>{selected.range}</dd>
                <dt>Components</dt><dd>{selected.components}</dd>
                <dt>Duration</dt><dd>{selected.duration}</dd>
              </dl>
              <p className="spells-detail-text">{selected.text}</p>
              {selected.atHigherLevels && (
                <p className="spells-detail-higher"><em>At Higher Levels.</em> {selected.atHigherLevels}</p>
              )}
              <p className="spells-detail-source">Source: {selected.source}</p>
            </div>
          )}
        </section>

      </div>
      <CharacterSheet />
    </div>
  );
}
