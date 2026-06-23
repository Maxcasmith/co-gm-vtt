import { useState } from 'react';
import { useCharacter } from './CharacterContext.tsx';
import { HIT_DICE, CLASS_FEATURES, SPECIES_FEATURES, BACKGROUND_FEAT, ORIGIN_FEAT_DETAILS, STAT_NAMES } from './srd.ts';

function conMod(stats: number[], backgroundAsi: Record<string, number>): number {
  const con = (stats[STAT_NAMES.indexOf('CON')] ?? 0) + (backgroundAsi['CON'] ?? 0);
  return Math.floor(((con || 10) - 10) / 2);
}

interface AccordionSectionProps {
  title: string;
  items: { name: string; description: string }[];
  openSet: Set<string>;
  toggle: (name: string) => void;
  namespace?: string;
}

function AccordionSection({ title, items, openSet, toggle, namespace = '' }: AccordionSectionProps) {
  if (items.length === 0) return null;
  return (
    <div className="char-sheet-section">
      <p className="char-sheet-section-title">{title}</p>
      {items.map(f => {
        const key = namespace + f.name;
        const isOpen = openSet.has(key);
        return (
          <div key={key} className="feature-item">
            <button className={`feature-toggle ${isOpen ? 'feature-toggle--open' : ''}`} onClick={() => toggle(key)}>
              <span className="feature-name">{f.name}</span>
              <span className="feature-arrow">{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && <p className="feature-desc">{f.description}</p>}
          </div>
        );
      })}
    </div>
  );
}

export default function CharacterSheet() {
  const c = useCharacter();
  const [open, setOpen] = useState<Set<string>>(new Set());

  function toggle(key: string) {
    setOpen(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const hitDie = c.characterClass ? HIT_DICE[c.characterClass] : null;
  const hp = hitDie != null ? hitDie + conMod(c.stats, c.backgroundAsi) : null;

  const classFeatures = c.characterClass ? (CLASS_FEATURES[c.characterClass] ?? []) : [];
  const speciesFeatures = c.species ? (SPECIES_FEATURES[c.species] ?? []) : [];
  const subspeciesFeatures = c.subspecies ? (SPECIES_FEATURES[c.subspecies] ?? []) : [];
  const originFeatDetail = c.speciesOriginFeat ? ORIGIN_FEAT_DETAILS[c.speciesOriginFeat] : undefined;
  const allSpeciesFeatures = [
    ...speciesFeatures,
    ...subspeciesFeatures,
    ...(originFeatDetail ? [originFeatDetail] : []),
  ];
  const bgFeat = c.background ? BACKGROUND_FEAT[c.background] : undefined;

  const hasContent = classFeatures.length > 0 || speciesFeatures.length > 0 || bgFeat;

  return (
    <div className="char-sheet">
      <div className="char-sheet-header">
        <p className="char-sheet-name">
          {c.name || <span className="char-sheet-placeholder">Unnamed Character</span>}
        </p>
        <p className="char-sheet-class">
          {c.characterClass || <span className="char-sheet-placeholder">No class selected</span>}
        </p>
        {(c.species || c.subspecies) && (
          <p className="char-sheet-species">
            {[c.species, c.subspecies].filter(Boolean).join(' · ')}
          </p>
        )}
        {c.background && <p className="char-sheet-background">{c.background}</p>}
      </div>

      {hp != null && (
        <div className="char-sheet-hp">
          <span className="char-sheet-hp-icon">♥</span>
          <span className="char-sheet-hp-value">{hp}</span>
          <span className="char-sheet-hp-label">HP (Lv. 1)</span>
        </div>
      )}

      {hasContent && (
        <div className="char-sheet-features">
          <AccordionSection
            title="Class Features"
            items={classFeatures}
            openSet={open}
            toggle={toggle}
            namespace="class:"
          />
          <AccordionSection
            title="Species Features"
            items={allSpeciesFeatures}
            openSet={open}
            toggle={toggle}
            namespace="species:"
          />
          {bgFeat && (
            <AccordionSection
              title="Background Features"
              items={[bgFeat]}
              openSet={open}
              toggle={toggle}
              namespace="bg:"
            />
          )}
        </div>
      )}

      {!hasContent && (
        <p className="char-sheet-hint">Select a class and species to see features</p>
      )}
    </div>
  );
}
