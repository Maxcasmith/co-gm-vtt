import { useEffect, useState } from 'react';
import type { Spell } from 'shared';
import { useCharacter } from './CharacterContext.tsx';
import { CLASS_FEATURES, FEAT_SPELL_GRANTS, BACKGROUND_FEAT, STAT_NAMES, BACKGROUND_ASI, CLASS_SKILLS, CLASS_SPELL_ALLOWANCE, SPECIES_SUBSPECIES } from './srd.ts';

const API = `http://${window.location.hostname}:3001`;

interface Props {
  error: string;
}

export default function FinishedTab({ error }: Props) {
  const c = useCharacter();
  const stats = c.toStats();
  const [spellDetails, setSpellDetails] = useState<Spell[]>([]);

  const learnedNames = Object.keys(c.learnedSpells);
  const bgFeatName = c.background ? BACKGROUND_FEAT[c.background] : undefined;
  const featSourceNames = [...new Set([bgFeatName, c.species === 'Human' ? c.speciesOriginFeat : undefined])]
    .filter((name): name is string => !!name && name in FEAT_SPELL_GRANTS);
  const featForClasses = featSourceNames.map(name => FEAT_SPELL_GRANTS[name]!.forClass);

  useEffect(() => {
    if (!c.characterClass || learnedNames.length === 0) { setSpellDetails([]); return; }
    const classList = [c.characterClass, ...featForClasses];
    const params = classList.map(cl => `class=${encodeURIComponent(cl)}`).join('&');
    fetch(`${API}/api/spells?${params}`)
      .then(r => r.json())
      .then((data: Spell[]) => setSpellDetails(data.filter(s => learnedNames.includes(s.name))))
      .catch(() => setSpellDetails([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.characterClass, featSourceNames.join(','), learnedNames.join(',')]);

  type Tab = typeof c.activeTab;
  const missing: { text: string; tab: Tab }[] = [];
  if (!c.name.trim()) missing.push({ text: 'Character name', tab: 'profile' });
  if (!c.password.trim()) missing.push({ text: 'Join password', tab: 'profile' });
  if (!c.characterClass) missing.push({ text: 'Class', tab: 'class' });
  if (!c.species) missing.push({ text: 'Species', tab: 'species' });
  else if ((SPECIES_SUBSPECIES[c.species] ?? []).length > 0 && !c.subspecies) missing.push({ text: 'Lineage', tab: 'species' });
  if (!c.rolled) missing.push({ text: 'Ability scores not rolled', tab: 'attributes' });
  else if (c.pool.length > 0) missing.push({ text: `${c.pool.length} rolled score(s) not assigned`, tab: 'attributes' });
  if (c.species === 'Human' && !c.speciesOriginFeat) missing.push({ text: 'Versatile origin feat', tab: 'attributes' });
  if (!c.background) missing.push({ text: 'Background', tab: 'attributes' });
  else {
    const asiLeft = 3 - (BACKGROUND_ASI[c.background] ?? []).reduce((n, st) => n + (c.backgroundAsi[st] ?? 0), 0);
    if (asiLeft > 0) missing.push({ text: `${asiLeft} background ability point(s) unspent`, tab: 'attributes' });
  }
  if (c.characterClass) {
    const classSkills = CLASS_SKILLS[c.characterClass];
    const picked = Object.values(c.skillProficiencies).filter(src => src === c.characterClass).length;
    if (classSkills && picked < classSkills.count) missing.push({ text: `${classSkills.count - picked} class skill(s) not chosen`, tab: 'attributes' });
    const features = CLASS_FEATURES[c.characterClass] ?? [];
    if (features.some(f => f.name === 'Fighting Style') && !c.fightingStyle) missing.push({ text: 'Fighting style', tab: 'classFeatures' });
    if (features.some(f => f.name === 'Divine Order' || f.name === 'Primal Order') && !c.classOrder) missing.push({ text: 'Class order', tab: 'classFeatures' });
    if (features.some(f => f.name === 'Eldritch Invocations') && c.invocations.length < 2) missing.push({ text: `${2 - c.invocations.length} invocation(s) not chosen`, tab: 'classFeatures' });
    const allowance = CLASS_SPELL_ALLOWANCE[c.characterClass];
    if (allowance && spellDetails.length === learnedNames.length) {
      const own = spellDetails.filter(sp => c.learnedSpells[sp.name] === c.characterClass);
      const cantrips = own.filter(sp => sp.level === 0).length;
      const leveled = own.length - cantrips;
      if (cantrips < allowance.cantrips) missing.push({ text: `${allowance.cantrips - cantrips} cantrip(s) not learned`, tab: 'spells' });
      if (leveled < allowance.spells) missing.push({ text: `${allowance.spells - leveled} spell(s) not learned`, tab: 'spells' });
    }
  }

  return (
    <>
        {c.backstory.trim() && (
          <section className="spells-section">
            <div className="spells-section-header">
              <h3 className="spells-section-title">Backstory</h3>
            </div>
            <p className="origin-feat-desc">{c.backstory}</p>
          </section>
        )}

        <section className="spells-section">
          <div className="spells-section-header">
            <h3 className="spells-section-title">Ability Scores</h3>
          </div>
          <div className="finished-stats-grid">
            {STAT_NAMES.map(stat => (
              <div key={stat} className="finished-stat">
                <span className="finished-stat-name">{stat}</span>
                <span className="finished-stat-value">{stats[stat.toLowerCase() as keyof typeof stats]}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="spells-section">
          <div className="spells-section-header">
            <h3 className="spells-section-title">Inventory</h3>
            <span className="spells-section-counts">{c.gold} gp remaining</span>
          </div>
          {c.inventory.length === 0 ? (
            <p className="spells-empty">No items yet.</p>
          ) : (
            <div className="spells-learned-list">
              {c.inventory.map(item => (
                <div key={item.id} className="spells-learned-chip">
                  <span className="spells-learned-name">{item.name}</span>
                  {item.quantity > 1 && <span className="spells-learned-level">×{item.quantity}</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="spells-section">
          <div className="spells-section-header">
            <h3 className="spells-section-title">Spells</h3>
          </div>
          {spellDetails.length === 0 ? (
            <p className="spells-empty">No spells learned.</p>
          ) : (
            <div className="spells-learned-list">
              {spellDetails.map(spell => {
                const source = c.learnedSpells[spell.name];
                return (
                  <div key={spell.name} className="spells-learned-chip">
                    <span className="spells-learned-name">{spell.name}</span>
                    {source && source !== c.characterClass && <span className="spells-tag spells-tag--ritual">{source}</span>}
                    <span className="spells-learned-level">{spell.levelLabel}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {missing.length > 0 && (
          <div className="finished-missing">
            <h3 className="finished-missing-title">Still missing</h3>
            <ul className="finished-missing-list">
              {missing.map(m => (
                <li key={m.text}>
                  <button type="button" className="finished-missing-item" onClick={() => c.set('activeTab', m.tab)}>{m.text}</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="modal-error create-error">{error}</p>}
    </>
  );
}
