import { useCharacter } from './CharacterContext.tsx';
import { SPECIES, SPECIES_SUBSPECIES, SPECIES_BLURBS, SPECIES_PLAIN_PERKS } from './srd.ts';
import TileGrid from './TileGrid.tsx';
import TileDetailPanel from './TileDetailPanel.tsx';

export default function SpeciesTab() {
  const c = useCharacter();
  const subspecies = SPECIES_SUBSPECIES[c.species] ?? [];

  return (
    <div className="select-section">
      <span className="modal-label">Species</span>
      <TileGrid
        items={SPECIES.map(s => ({ id: s, name: s }))}
        selectedId={c.species}
        onSelect={id => { c.set('species', id); c.set('subspecies', ''); c.set('speciesOriginFeat', ''); }}
      />
      {subspecies.length > 0 && (
        <label className="modal-label modal-label--sub">
          Lineage
          <select className="modal-select" value={c.subspecies} onChange={e => c.set('subspecies', e.target.value)}>
            <option value="">Select lineage…</option>
            {subspecies.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
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
