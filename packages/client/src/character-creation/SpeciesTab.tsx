import { useCharacter } from './CharacterContext.tsx';
import { playable, SPECIES_SUBSPECIES, SPECIES_BLURBS, SPECIES_PLAIN_PERKS, ORIGIN_FEAT_DETAILS, speciesSpellGrant } from './srd.ts';
import { useAppMeta } from '../AppMetaContext.tsx';
import TileGrid from './TileGrid.tsx';
import TileDetailPanel from './TileDetailPanel.tsx';

export default function SpeciesTab() {
  const c = useCharacter();
  const { species, originFeats } = playable(useAppMeta().srdOnly);
  const subspecies = SPECIES_SUBSPECIES[c.species] ?? [];

  // Lineage cantrips are pre-learned the moment the lineage is picked, replacing whatever the
  // previous lineage granted — the player can still forget/swap them on the Spells step.
  function setLineage(species: string, sub: string) {
    const prev = speciesSpellGrant(c.species, c.subspecies);
    const next = speciesSpellGrant(species, sub);
    const learned = Object.fromEntries(Object.entries(c.learnedSpells).filter(([, src]) => src !== prev?.label));
    for (const name of next?.cantrips ?? []) learned[name] ??= next!.label;
    c.set('species', species);
    c.set('subspecies', sub);
    c.set('learnedSpells', learned);
  }

  return (
    <div className="select-section">
      <span className="modal-label">Species</span>
      <TileGrid
        items={species.map(s => ({ id: s, name: s }))}
        selectedId={c.species}
        onSelect={id => { setLineage(id, ''); c.set('speciesOriginFeat', ''); }}
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
      {c.species === 'Human' && (
        <label className="modal-label modal-label--sub">
          Versatile — Origin Feat
          <select className="modal-select" value={c.speciesOriginFeat} onChange={e => c.set('speciesOriginFeat', e.target.value)}>
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
          name={c.subspecies ? `${c.species} — ${c.subspecies}` : c.species}
          blurb={SPECIES_BLURBS[c.species]}
          perks={SPECIES_PLAIN_PERKS[c.species] ?? []}
        />
      )}
    </div>
  );
}
