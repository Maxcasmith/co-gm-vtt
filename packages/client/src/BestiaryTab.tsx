import { useEffect, useState } from 'react';

const API = `http://${window.location.hostname}:3001`;

interface BestiaryCreature {
  slug: string;
  name: string;
  cr: number;
  creatureType?: string;
  portraitSrc?: string;
}

export default function BestiaryTab() {
  const [creatures, setCreatures] = useState<BestiaryCreature[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${API}/api/creatures/manifest`)
      .then(r => r.json())
      .then((data: BestiaryCreature[]) => setCreatures(data))
      .catch(() => {});
  }, []);

  function toggle(letter: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(letter)) next.delete(letter); else next.add(letter);
      return next;
    });
  }

  if (creatures.length === 0) {
    return <div className="admin-table-card"><p className="admin-empty">No creatures encountered yet.</p></div>;
  }

  const groups = new Map<string, BestiaryCreature[]>();
  for (const c of creatures) {
    const letter = c.name[0]?.toUpperCase() ?? '#';
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(c);
  }
  const letters = [...groups.keys()].sort();

  return (
    <div className="tiles-accordion">
      {letters.map(letter => {
        const isOpen = expanded.has(letter);
        const group = groups.get(letter)!;
        return (
          <div key={letter} className="tiles-accordion-item">
            <div className="tiles-accordion-header">
              <button className="tiles-accordion-toggle" onClick={() => toggle(letter)} aria-expanded={isOpen}>
                <span className="tiles-accordion-caret">{isOpen ? '▾' : '▸'}</span>
                <span className="tiles-accordion-name">{letter}</span>
                <span className="admin-module-counts">{group.length} creature{group.length === 1 ? '' : 's'}</span>
              </button>
            </div>
            {isOpen && (
              <div className="tiles-accordion-body">
                <div className="tile-grid">
                  {group.map(c => (
                    <div key={c.slug} className="tile-card">
                      {c.portraitSrc ? (
                        <img src={`${API}${c.portraitSrc}`} alt={c.name} title={c.name} className="tile-img" />
                      ) : (
                        <div className="tile-img tile-img--placeholder" title={c.name} aria-label={c.name}>{c.name[0]}</div>
                      )}
                      <span className="tile-label">{c.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
