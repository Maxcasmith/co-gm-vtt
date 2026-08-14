import { useEffect, useState } from 'react';
import type { Spell } from 'shared';
import { useCharacter } from './CharacterContext.tsx';
import { FEAT_SPELL_GRANTS, BACKGROUND_FEAT, STAT_NAMES } from './srd.ts';
import CharacterSheet from './CharacterSheet.tsx';

const API = `http://${window.location.hostname}:3001`;

interface Props {
  onCreate: () => void;
  canCreate: boolean;
  saving: boolean;
  error: string;
}

export default function FinishedTab({ onCreate, canCreate, saving, error }: Props) {
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

  return (
    <div className="player-info-layout">
      <div className="tab-content">

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

        {error && <p className="modal-error create-error">{error}</p>}

        <div className="finished-create-row">
          <button className="btn-primary" onClick={onCreate} disabled={!canCreate || saving}>
            {saving ? 'Creating…' : 'Create Character'}
          </button>
        </div>
      </div>
      <CharacterSheet />
    </div>
  );
}
