import { useEffect, useState, useMemo } from 'react';
import type { Spell } from 'shared';
import { useCharacter } from './CharacterContext.tsx';
import TileGrid from './TileGrid.tsx';
import { CLASS_FEATURES, CLASS_SPELL_ALLOWANCE, FEAT_SPELL_GRANTS, BACKGROUND_FEAT, PACT_OF_THE_TOME, speciesSpellGrant } from './srd.ts';

const API = `http://${window.location.hostname}:3001`;

const LEVEL_LABELS: Record<number, string> = {
  0: 'Cantrip', 1: '1st', 2: '2nd', 3: '3rd', 4: '4th',
  5: '5th', 6: '6th', 7: '7th', 8: '8th', 9: '9th',
};

export default function SpellsTab() {
  const c = useCharacter();

  const isSpellcaster = c.characterClass
    ? (CLASS_FEATURES[c.characterClass] ?? []).some(f => f.name === 'Spellcasting' || f.name === 'Pact Magic')
    : false;

  const allowance = CLASS_SPELL_ALLOWANCE[c.characterClass] ?? null;

  // Every character's Background grants a fixed Origin feat; a Human additionally gets one of
  // their own choice (Versatile). Either or both can be a Magic Initiate variant, and each is
  // tracked as an independent pool (own cantrip/spell cap, own label) so they never merge.
  const bgFeatName = c.background ? BACKGROUND_FEAT[c.background] : undefined;
  const featSourceNames = [...new Set([bgFeatName, c.species === 'Human' ? c.speciesOriginFeat : undefined])]
    .filter((name): name is string => !!name && name in FEAT_SPELL_GRANTS);
  const featSources = featSourceNames.map(name => ({ name, grant: FEAT_SPELL_GRANTS[name]! }));

  // Species/lineage cantrips (High Elf, Tiefling, ...) — a third independent pool, labelled by
  // lineage. Fixed-spell lineages only accept their own defaults; High Elf takes any Wizard cantrip.
  const lineage = speciesSpellGrant(c.species, c.subspecies);
  function lineageEligible(spell: Spell): boolean {
    if (!lineage || spell.level !== 0) return false;
    return lineage.forClass ? spell.classes.includes(lineage.forClass) : lineage.cantrips.includes(spell.name);
  }

  // Pact of the Tome — a fourth pool: any class's cantrips, and level 1 spells with the Ritual tag.
  const tome = c.invocations.includes(PACT_OF_THE_TOME.label);
  function tomeEligible(spell: Spell): boolean {
    return tome && (spell.level === 0 || (spell.level === 1 && spell.isRitual));
  }

  // A spell only reachable through a feat's class or a lineage (not also on the character's own
  // class list) can never draw from the class pool. Used for the "foreign spell" badge in the
  // browser; the actual pool a *learned* spell drew from is its recorded source.
  function featOnlySource(spell: Spell): string | undefined {
    if (spell.classes.includes(c.characterClass)) return undefined;
    return featSources.find(fs => spell.classes.includes(fs.grant.forClass))?.name ?? (lineageEligible(spell) ? lineage!.label : undefined)
      ?? (tomeEligible(spell) ? PACT_OF_THE_TOME.label : undefined);
  }

  // Thaumaturge (Divine Order) and Magician (Primal Order) each know one cantrip beyond the
  // class's normal allowance — see ClassFeaturesTab/effectiveWeaponProfs' sibling note in shared.
  const orderCantripBonus =
    (c.characterClass === 'Cleric' && c.classOrder === 'Thaumaturge') ||
    (c.characterClass === 'Druid' && c.classOrder === 'Magician') ? 1 : 0;
  const maxCantrips = (allowance?.cantrips ?? 0) + orderCantripBonus;
  const maxSpells   = allowance?.spells  ?? 0;

  const [allSpells, setAllSpells] = useState<Spell[]>([]);
  const [loading, setLoading]    = useState(false);
  const [filterLevel, setFilterLevel]   = useState<string>('all');
  const [filterSchool, setFilterSchool] = useState<string>('all');
  const [filterRitual, setFilterRitual] = useState<string>('all');
  const [search, setSearch]             = useState('');
  const [selected, setSelected]         = useState<Spell | null>(null);

  // Character creation is always level 1 — only cantrips and 1st-level spells are learnable. A
  // lineage's fixed cantrips can sit on any class list, so fetch by level and keep whatever some
  // pool (class, feat, lineage) could learn.
  useEffect(() => {
    if (!c.characterClass && featSources.length === 0 && !lineage) return;
    setLoading(true);
    fetch(`${API}/api/spells?level=0&level=1`)
      .then(r => r.json())
      .then((data: Spell[]) => setAllSpells(data.filter(s =>
        s.classes.includes(c.characterClass) || featSources.some(fs => s.classes.includes(fs.grant.forClass)) || lineageEligible(s) || tomeEligible(s))))
      .catch(() => setAllSpells([]))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.characterClass, featSourceNames.join(','), lineage?.label, tome]);

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

  const learnedSet = new Set(Object.keys(c.learnedSpells));

  function countBySource(level0: boolean, source: string): number {
    return Object.entries(c.learnedSpells).filter(([name, src]) => {
      if (src !== source) return false;
      const s = allSpells.find(sp => sp.name === name && (level0 ? sp.level === 0 : sp.level > 0));
      return !!s;
    }).length;
  }
  const learnedCantrips     = countBySource(true, c.characterClass);
  const learnedSpellCount   = countBySource(false, c.characterClass);
  const learnedLineageCantrips = lineage ? countBySource(true, lineage.label) : 0;
  const learnedTomeCantrips = countBySource(true, PACT_OF_THE_TOME.label);
  const learnedTomeSpells   = countBySource(false, PACT_OF_THE_TOME.label);

  // A same-class Magic Initiate merges its spell list with the class's own, so most spells are
  // eligible for either pool. Class slots fill first; once those are full, eligible spells spill
  // into a feat's own slots instead of being blocked outright.
  function classSlot(spell: Spell): boolean {
    const isCantrip = spell.level === 0;
    return spell.classes.includes(c.characterClass) &&
      (isCantrip ? learnedCantrips < maxCantrips : learnedSpellCount < maxSpells);
  }
  function featSlotSource(spell: Spell): string | undefined {
    const isCantrip = spell.level === 0;
    return featSources.find(fs => {
      if (!spell.classes.includes(fs.grant.forClass)) return false;
      const learned = countBySource(isCantrip, fs.name);
      return isCantrip ? learned < fs.grant.cantrips : learned < fs.grant.spells;
    })?.name;
  }

  function lineageSlot(spell: Spell): string | undefined {
    return lineage && lineageEligible(spell) && learnedLineageCantrips < lineage.cantrips.length ? lineage.label : undefined;
  }

  function tomeSlot(spell: Spell): string | undefined {
    if (!tomeEligible(spell)) return undefined;
    const open = spell.level === 0 ? learnedTomeCantrips < PACT_OF_THE_TOME.cantrips : learnedTomeSpells < PACT_OF_THE_TOME.spells;
    return open ? PACT_OF_THE_TOME.label : undefined;
  }

  function limitReached(spell: Spell): boolean {
    return !classSlot(spell) && !featSlotSource(spell) && !lineageSlot(spell) && !tomeSlot(spell);
  }

  function toggleLearn(spell: Spell) {
    if (learnedSet.has(spell.name)) {
      const next = { ...c.learnedSpells };
      delete next[spell.name];
      c.set('learnedSpells', next);
    } else {
      const source = classSlot(spell) ? c.characterClass : featSlotSource(spell) ?? lineageSlot(spell) ?? tomeSlot(spell);
      if (!source) return;
      c.set('learnedSpells', { ...c.learnedSpells, [spell.name]: source });
    }
  }

  if (!isSpellcaster && featSources.length === 0 && !lineage) {
    return (
      <div className="spells-placeholder">
        <p className="spells-placeholder-title">No Spellcasting</p>
        <p className="spells-placeholder-body">
          {c.characterClass
            ? `${c.characterClass}s do not have the ability to cast spells.`
            : 'Select a class to see spellcasting information.'}
        </p>
      </div>
    );
  }

  return (
    <div className="spells-tab">

      {/* ── Spell tiles: selecting a tile learns it, deselecting forgets it ── */}
        <section className="spells-section">
          <div className="spells-section-header">
            <h3 className="spells-section-title">Spells</h3>
            <span className="spells-section-counts">
              {maxCantrips > 0 && <span className={learnedCantrips >= maxCantrips ? 'spells-count spells-count--full' : 'spells-count'}>{learnedCantrips}/{maxCantrips} cantrips</span>}
              {maxSpells > 0   && <span className={learnedSpellCount >= maxSpells ? 'spells-count spells-count--full' : 'spells-count'}>{learnedSpellCount}/{maxSpells} spells</span>}
              {featSources.flatMap(fs => {
                const learnedFeatCantrips = countBySource(true, fs.name);
                const learnedFeatSpells   = countBySource(false, fs.name);
                return [
                  fs.grant.cantrips > 0 && <span key={`${fs.name}-c`} className={learnedFeatCantrips >= fs.grant.cantrips ? 'spells-count spells-count--full' : 'spells-count'}>{learnedFeatCantrips}/{fs.grant.cantrips} {fs.name} cantrips</span>,
                  fs.grant.spells > 0   && <span key={`${fs.name}-s`} className={learnedFeatSpells >= fs.grant.spells ? 'spells-count spells-count--full' : 'spells-count'}>{learnedFeatSpells}/{fs.grant.spells} {fs.name} spells</span>,
                ];
              })}
              {tome && <span className={learnedTomeCantrips >= PACT_OF_THE_TOME.cantrips ? 'spells-count spells-count--full' : 'spells-count'}>{learnedTomeCantrips}/{PACT_OF_THE_TOME.cantrips} {PACT_OF_THE_TOME.label} cantrips</span>}
              {tome && <span className={learnedTomeSpells >= PACT_OF_THE_TOME.spells ? 'spells-count spells-count--full' : 'spells-count'}>{learnedTomeSpells}/{PACT_OF_THE_TOME.spells} {PACT_OF_THE_TOME.label} rituals</span>}
              {lineage && <span className={learnedLineageCantrips >= lineage.cantrips.length ? 'spells-count spells-count--full' : 'spells-count'}>{learnedLineageCantrips}/{lineage.cantrips.length} {lineage.label} cantrips</span>}
            </span>
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
              {[0,1].map(l => (
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
            <div className="spells-tile-scroll">
              <TileGrid
                items={filtered.map(spell => {
                  const source = c.learnedSpells[spell.name] ?? featOnlySource(spell);
                  return {
                    id: spell.name,
                    name: spell.name,
                    // A full pool doesn't block the click — it still opens the details.
                    dimmed: !learnedSet.has(spell.name) && limitReached(spell),
                    meta: (
                      <span className="spells-tile-tags">
                        <span className="spells-tag">{spell.levelLabel}</span>
                        <span className="spells-tag">{spell.school}</span>
                        {source && source !== c.characterClass && <span className="spells-tag spells-tag--ritual">{source}</span>}
                        {spell.isRitual && <span className="spells-tag spells-tag--ritual">Ritual</span>}
                      </span>
                    ),
                  };
                })}
                selectedId={[...learnedSet]}
                onSelect={name => {
                  const spell = filtered.find(s => s.name === name);
                  if (!spell) return;
                  setSelected(spell);
                  toggleLearn(spell);
                }}
              />
            </div>
          )}
        </section>

        {/* ── Section 3: Spell detail ── */}
        <section className="spells-section spells-detail-section">
          <div className="spells-section-header">
            <h3 className="spells-section-title">Spell Details</h3>
          </div>
          {!selected ? (
            <p className="spells-empty">Click a spell to learn it and see its details — click it again to forget it.</p>
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
  );
}
