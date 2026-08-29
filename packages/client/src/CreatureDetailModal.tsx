interface EnemyAttack {
  name: string;
  bonus: number;
  damage: string;
}

interface CreatureDetail {
  slug: string;
  name: string;
  cr?: number;
  creatureType?: string;
  role?: string;
  hp?: number;
  ac?: number;
  speed?: number;
  stats?: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  attacks?: EnemyAttack[];
  appearance?: string;
  damageResistances?: string[];
  damageVulnerabilities?: string[];
  damageImmunities?: string[];
  portraitSrc?: string;
}

interface Props {
  creature: CreatureDetail | null;
  onClose: () => void;
  onDelete: () => void;
  deleteError?: string;
}

const API = `http://${window.location.hostname}:3001`;

function modifier(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

const ABILITY_LABELS: [key: keyof NonNullable<CreatureDetail['stats']>, label: string][] = [
  ['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA'],
];

export default function CreatureDetailModal({ creature, onClose, onDelete, deleteError }: Props) {
  if (!creature) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <dialog className="modal super-modal" open onClick={e => e.stopPropagation()}>
        <button className="sheet-close campaign-modal-close" onClick={onClose} aria-label="Close">×</button>
        <h2 className="modal-title">{creature.name}</h2>

        <div className="super-modal-body creature-detail-body">
          <div className="creature-detail-portrait">
            {creature.portraitSrc ? (
              <img src={`${API}${creature.portraitSrc}`} alt={creature.name} />
            ) : (
              <div className="tile-img tile-img--placeholder">{creature.name[0]}</div>
            )}
          </div>

          <div className="creature-detail-stats">
            <p className="creature-detail-subtitle">
              {creature.creatureType ?? 'Unknown type'}{creature.cr !== undefined ? ` — CR ${creature.cr}` : ''}{creature.role ? ` — ${creature.role}` : ''}
            </p>

            <div className="creature-detail-vitals">
              {creature.ac !== undefined && <div><span className="creature-detail-label">AC</span> {creature.ac}</div>}
              {creature.hp !== undefined && <div><span className="creature-detail-label">HP</span> {creature.hp}</div>}
              {creature.speed !== undefined && <div><span className="creature-detail-label">Speed</span> {creature.speed} ft.</div>}
            </div>

            {creature.stats && (
              <div className="creature-detail-abilities">
                {ABILITY_LABELS.map(([key, label]) => (
                  <div key={key} className="creature-detail-ability">
                    <span className="creature-detail-label">{label}</span>
                    <span>{creature.stats![key]} ({modifier(creature.stats![key])})</span>
                  </div>
                ))}
              </div>
            )}

            {(creature.damageResistances?.length || creature.damageVulnerabilities?.length || creature.damageImmunities?.length) ? (
              <div className="creature-detail-resistances">
                {creature.damageResistances?.length ? <p><span className="creature-detail-label">Resistances</span> {creature.damageResistances.join(', ')}</p> : null}
                {creature.damageVulnerabilities?.length ? <p><span className="creature-detail-label">Vulnerabilities</span> {creature.damageVulnerabilities.join(', ')}</p> : null}
                {creature.damageImmunities?.length ? <p><span className="creature-detail-label">Immunities</span> {creature.damageImmunities.join(', ')}</p> : null}
              </div>
            ) : null}

            {creature.attacks?.length ? (
              <div className="creature-detail-attacks">
                <div className="admin-section-title">Attacks</div>
                {creature.attacks.map((a, i) => (
                  <p key={i}>
                    <strong>{a.name}</strong> — {a.bonus >= 0 ? `+${a.bonus}` : a.bonus} to hit, {a.damage} damage
                  </p>
                ))}
              </div>
            ) : null}

            {creature.appearance && (
              <div className="creature-detail-appearance">
                <div className="admin-section-title">Appearance</div>
                <p>{creature.appearance}</p>
              </div>
            )}
          </div>
        </div>

        {deleteError && <p className="modal-error">{deleteError}</p>}

        <div className="modal-actions">
          <button className="btn-danger" onClick={onDelete}>Delete</button>
          <button className="btn-primary" onClick={onClose}>Close</button>
        </div>
      </dialog>
    </div>
  );
}
