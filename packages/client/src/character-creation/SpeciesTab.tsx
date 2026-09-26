import { DRACONIC_ANCESTRIES } from 'shared';
import { useCharacter } from './CharacterContext.tsx';
import { playable, SPECIES_SUBSPECIES, SPECIES_BLURBS, SPECIES_PLAIN_PERKS, ORIGIN_FEAT_DETAILS, speciesSpellGrant } from './srd.ts';
import { pruneSkills } from './SkillPicker.tsx';
import { useAppMeta } from '../AppMetaContext.tsx';
import TileGrid from './TileGrid.tsx';
import TileDetailPanel from './TileDetailPanel.tsx';

export default function SpeciesTab() {
  const c = useCharacter();
  const { species, originFeats } = playable(useAppMeta().srdOnly);
  const subspecies = SPECIES_SUBSPECIES[c.species] ?? [];
  const ancestries = c.species === 'Dragonborn' ? Object.entries(DRACONIC_ANCESTRIES[c.subspecies] ?? {}) : [];

  // Lineage cantrips are pre-learned the moment the lineage is picked, replacing whatever the
  // previous lineage granted — the player can still forget/swap them on the Spells step.
  function setLineage(species: string, sub: string) {
    const prev = speciesSpellGrant(c.species, c.subspecies);
    const next = speciesSpellGrant(species, sub);
    const learned = Object.fromEntries(Object.entries(c.learnedSpells).filter(([, src]) => src !== prev?.label));
    for (const name of next?.cantrips ?? []) learned[name] ??= next!.label;
    c.set('species', species);
    c.set('subspecies', sub);
    c.set('draconicAncestry', '');
    c.set('learnedSpells', learned);
  }

  // Skillful / Keen Senses / Human's Skilled picks belong to the species (and its origin feat) —
  // drop them, and any Expertise riding on them, when either changes.
  function pruneSpeciesSkills(species: string, speciesOriginFeat: string) {
    const pruned = pruneSkills({ ...c, species, speciesOriginFeat });
    c.set('skillProficiencies', pruned.skillProficiencies);
    c.set('expertiseSkills', pruned.expertiseSkills);
  }

  return (
    <div className="select-section">
      <span className="modal-label">Species</span>
      <TileGrid
        items={species.map(s => ({ id: s, name: s }))}
        selectedId={c.species}
        onSelect={id => { setLineage(id, ''); c.set('speciesOriginFeat', ''); pruneSpeciesSkills(id, ''); }}
      />
      {subspecies.length > 0 && (
        <label className="modal-label modal-label--sub">
          Lineage
          <select className="modal-select" value={c.subspecies} onChange={e => setLineage(c.species, e.target.value)}>
            <option value="">Select lineage…</option>
            {subspecies.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      {ancestries.length > 0 && (
        <label className="modal-label modal-label--sub">
          Draconic Ancestry
          <select className="modal-select" value={c.draconicAncestry} onChange={e => c.set('draconicAncestry', e.target.value)}>
            <option value="">Select dragon…</option>
            {ancestries.map(([dragon, damageType]) => <option key={dragon} value={dragon}>{dragon} ({damageType})</option>)}
          </select>
        </label>
      )}
      {c.species === 'Human' && (
        <label className="modal-label modal-label--sub">
          Versatile — Origin Feat
          <select className="modal-select" value={c.speciesOriginFeat} onChange={e => { c.set('speciesOriginFeat', e.target.value); pruneSpeciesSkills(c.species, e.target.value); }}>
            <option value="">Select origin feat…</option>
            {originFeats.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          {c.speciesOriginFeat && ORIGIN_FEAT_DETAILS[c.speciesOriginFeat] && (
            <p className="origin-feat-desc">{ORIGIN_FEAT_DETAILS[c.speciesOriginFeat]!.description}</p>
          )}
        </label>
      )}
      {c.species && (
        <TileDetailPanel
          name={[c.species, c.subspecies, c.draconicAncestry].filter(Boolean).join(' — ')}
          blurb={SPECIES_BLURBS[c.species]}
          perks={SPECIES_PLAIN_PERKS[c.species] ?? []}
        />
      )}
    </div>
  );
}
