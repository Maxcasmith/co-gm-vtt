import { useCharacter } from './CharacterContext.tsx';
import { playable, CLASS_BLURBS, CLASS_PLAIN_PERKS } from './srd.ts';
import { useAppMeta } from '../AppMetaContext.tsx';
import TileGrid from './TileGrid.tsx';
import TileDetailPanel from './TileDetailPanel.tsx';
import { pruneSkills } from './SkillPicker.tsx';
import { withInvocationSpells } from './ClassFeaturesTab.tsx';

export default function ClassTab() {
  const c = useCharacter();
  const { classes } = playable(useAppMeta().srdOnly);
  return (
    <div className="select-section">
      <span className="modal-label">Class</span>
      <TileGrid
        items={classes.map(cl => ({ id: cl, name: cl }))}
        selectedId={c.characterClass}
        onSelect={id => {
          // Drops the old class's skill picks (and Expertise) but keeps species/background ones.
          const pruned = pruneSkills({ ...c, characterClass: id });
          c.set('characterClass', id);
          c.set('skillProficiencies', pruned.skillProficiencies);
          c.set('expertiseSkills', pruned.expertiseSkills);
          if (id !== 'Warlock') {
            c.set('invocations', []);
            c.set('learnedSpells', withInvocationSpells(c.learnedSpells));
          }
        }}
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
