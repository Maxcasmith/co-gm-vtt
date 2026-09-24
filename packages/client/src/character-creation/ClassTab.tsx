import { useCharacter } from './CharacterContext.tsx';
import { CLASSES, CLASS_BLURBS, CLASS_PLAIN_PERKS } from './srd.ts';
import TileGrid from './TileGrid.tsx';
import TileDetailPanel from './TileDetailPanel.tsx';

export default function ClassTab() {
  const c = useCharacter();
  return (
    <div className="select-section">
      <span className="modal-label">Class</span>
      <TileGrid
        items={CLASSES.map(cl => ({ id: cl, name: cl }))}
        selectedId={c.characterClass}
        onSelect={id => { c.set('characterClass', id); c.set('skillProficiencies', {}); }}
      />
      {c.characterClass && (
        <TileDetailPanel
          name={c.characterClass}
          blurb={CLASS_BLURBS[c.characterClass]}
          perks={CLASS_PLAIN_PERKS[c.characterClass] ?? []}
        />
      )}
    </div>
  );
}
