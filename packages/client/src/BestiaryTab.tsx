import { useEffect, useState } from 'react';
import CreatureDetailModal from './CreatureDetailModal.tsx';

const API = `http://${window.location.hostname}:3001`;

interface BestiaryCreature {
  slug: string;
  name: string;
  cr?: number;
  creatureType?: string;
  role?: string;
  hp?: number;
  ac?: number;
  speed?: number;
  stats?: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  attacks?: { name: string; bonus: number; damage: string }[];
  appearance?: string;
  damageResistances?: string[];
  damageVulnerabilities?: string[];
  damageImmunities?: string[];
  portraitSrc?: string;
}

interface UsageRef {
  kind: 'campaign' | 'saved-adventure';
  id: string;
  name: string;
}

interface BestiaryTabProps {
  password: string;
}

export default function BestiaryTab({ password }: BestiaryTabProps) {
  const [creatures, setCreatures] = useState<BestiaryCreature[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<BestiaryCreature | null>(null);
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(`${API}/api/creatures/manifest`)
      .then(r => r.json())
      .then((data: BestiaryCreature[]) => setCreatures(data))
      .catch(() => {});
  }, []);

  async function deleteCreature(slug: string, name: string) {
    if (!window.confirm(`Permanently delete "${name}"'s portrait and stats? This cannot be undone.`)) return;
    setDeleteError(f => { const n = { ...f }; delete n[slug]; return n; });
    const r = await fetch(`${API}/api/admin/creatures/${slug}`, {
      method: 'DELETE',
      headers: { 'x-admin-password': password },
    });
    if (r.ok) {
      setCreatures(cs => cs.filter(c => c.slug !== slug));
      setSelected(null);
    } else {
      const data = await r.json().catch(() => ({})) as { usage?: UsageRef[] };
      const where = data.usage?.map(u => `${u.kind === 'campaign' ? 'campaign' : 'saved adventure'} "${u.name}"`).join(', ');
      setDeleteError(f => ({ ...f, [slug]: where ? `Still used in ${where}` : 'Failed to delete' }));
    }
  }

  function selectCreature(c: BestiaryCreature) {
    setDeleteError(f => { const n = { ...f }; delete n[c.slug]; return n; });
    setSelected(c);
  }

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
                    <button key={c.slug} className="tile-card tile-card-button" onClick={() => selectCreature(c)}>
                      {c.portraitSrc ? (
                        <img src={`${API}${c.portraitSrc}`} alt={c.name} title={c.name} className="tile-img" />
                      ) : (
                        <div className="tile-img tile-img--placeholder" title={c.name} aria-label={c.name}>{c.name[0]}</div>
                      )}
                      <span className="tile-label">{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <CreatureDetailModal
        creature={selected}
        onClose={() => setSelected(null)}
        onDelete={() => { if (selected) void deleteCreature(selected.slug, selected.name); }}
        deleteError={selected ? deleteError[selected.slug] : undefined}
      />
    </div>
  );
}
