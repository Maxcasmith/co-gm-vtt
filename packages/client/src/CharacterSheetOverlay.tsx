import { useEffect, useState } from 'react';
import type { Character } from 'shared';
import { on, dispatch } from './events.ts';
import {
  STAT_NAMES,
  CLASS_SAVING_THROWS,
  CLASS_FEATURES,
  SPECIES_FEATURES,
  BACKGROUND_FEAT,
  BACKGROUND_SKILLS,
  HIT_DICE,
  SKILLS,
} from './character-creation/srd.ts';

const API = `http://${window.location.hostname}:3001`;
const PROF = 2;

function mod(score: number): string {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}
function modNum(score: number) { return Math.floor((score - 10) / 2); }

const STAT_KEYS: Array<keyof Character['stats']> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

type SheetTab = 'abilities' | 'features' | 'inventory';

interface Props { character: Character }

// ── Abilities ─────────────────────────────────────────────────────────────────

function AbilitiesTab({ character }: { character: Character }) {
  const cls = character.class;
  const proficientSaves = new Set<string>(CLASS_SAVING_THROWS[cls] ?? []);
  const proficientSkills = new Set<string>([
    ...(BACKGROUND_SKILLS[character.background] ?? []),
    ...(character.skillProficiencies ?? []),
  ]);

  return (
    <>
      <div className="sheet-stats">
        {STAT_KEYS.map((key, i) => (
          <div
            key={key}
            className="stat-card stat-card--clickable"
            onClick={() => dispatch('vtt:roll:check', { characterId: character.id, campaignId: character.campaignId, stat: key })}
            title={`Roll ${STAT_NAMES[i]} check`}
          >
            <div className="stat-card-name">{STAT_NAMES[i]}</div>
            <div className="stat-card-score">{character.stats[key]}</div>
            <div className="stat-card-mod">{mod(character.stats[key])}</div>
          </div>
        ))}
      </div>

      <div className="sheet-body">
        <div>
          <p className="sheet-section-title">Saving Throws</p>
          {STAT_KEYS.map((key, i) => {
            const statName = STAT_NAMES[i]!;
            const proficient = proficientSaves.has(statName);
            const bonus = modNum(character.stats[key]) + (proficient ? PROF : 0);
            return (
              <div
                key={key}
                className="sheet-save-row sheet-save-row--clickable"
                onClick={() => dispatch('vtt:roll:save', { characterId: character.id, campaignId: character.campaignId, stat: key })}
                title={`Roll ${statName} saving throw`}
              >
                <span className={`sheet-save-dot${proficient ? ' sheet-save-dot--filled' : ''}`} />
                <span className="sheet-save-label">{statName}</span>
                <span className="sheet-save-val">{bonus >= 0 ? `+${bonus}` : bonus}</span>
              </div>
            );
          })}
        </div>

        <div>
          <p className="sheet-section-title">Ability Checks</p>
          {SKILLS.map(skill => {
            const statKey = skill.stat.toLowerCase() as keyof Character['stats'];
            const proficient = proficientSkills.has(skill.name);
            const bonus = modNum(character.stats[statKey]) + (proficient ? PROF : 0);
            return (
              <div
                key={skill.name}
                className="sheet-save-row sheet-save-row--clickable"
                onClick={() => dispatch('vtt:roll:check', { characterId: character.id, campaignId: character.campaignId, stat: statKey, skill: skill.name })}
                title={`Roll ${skill.name} check`}
              >
                <span className={`sheet-save-dot${proficient ? ' sheet-save-dot--filled' : ''}`} />
                <span className="sheet-save-label">{skill.name}</span>
                <span className="sheet-save-val sheet-save-stat">{skill.stat}</span>
                <span className="sheet-save-val">{bonus >= 0 ? `+${bonus}` : bonus}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────

function FeaturesTab({ character }: { character: Character }) {
  const cls = character.class;
  return (
    <>
      {(CLASS_FEATURES[cls] ?? []).length > 0 && (
        <div className="sheet-feature-group">
          <p className="sheet-feature-group-title">{cls} Features</p>
          {CLASS_FEATURES[cls]!.map(f => (
            <div key={f.name} className="sheet-feature">
              <div className="sheet-feature-name">{f.name}</div>
              <div className="sheet-feature-desc">{f.description}</div>
            </div>
          ))}
        </div>
      )}

      {(SPECIES_FEATURES[character.species] ?? []).length > 0 && (
        <div className="sheet-feature-group">
          <p className="sheet-feature-group-title">{character.species} Traits</p>
          {SPECIES_FEATURES[character.species]!.map(f => (
            <div key={f.name} className="sheet-feature">
              <div className="sheet-feature-name">{f.name}</div>
              <div className="sheet-feature-desc">{f.description}</div>
            </div>
          ))}
        </div>
      )}

      {(BACKGROUND_FEAT[character.background] || (BACKGROUND_SKILLS[character.background] ?? []).length > 0) && (
        <div className="sheet-feature-group">
          <p className="sheet-feature-group-title">{character.background} Background</p>
          {BACKGROUND_FEAT[character.background] && (
            <div className="sheet-feature">
              <div className="sheet-feature-name">{BACKGROUND_FEAT[character.background]!.name}</div>
              <div className="sheet-feature-desc">{BACKGROUND_FEAT[character.background]!.description}</div>
            </div>
          )}
          {(BACKGROUND_SKILLS[character.background] ?? []).length > 0 && (
            <div className="sheet-feature">
              <div className="sheet-feature-name">Skill Proficiencies</div>
              <div className="sheet-feature-desc">{BACKGROUND_SKILLS[character.background]!.join(', ')}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Inventory ─────────────────────────────────────────────────────────────────

function InventoryTab() {
  return (
    <div className="sheet-empty">
      <p className="sheet-empty-title">No items yet</p>
      <p className="sheet-empty-hint">Items will appear here as you acquire them</p>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

const TABS: { id: SheetTab; label: string }[] = [
  { id: 'abilities', label: 'Abilities' },
  { id: 'features',  label: 'Features'  },
  { id: 'inventory', label: 'Inventory' },
];

export default function CharacterSheetOverlay({ character }: Props) {
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<SheetTab>('abilities');

  useEffect(() => {
    const unsubOpen  = on('vtt:sheet:opened', () => setVisible(true));
    const unsubClose = on('vtt:sheet:closed', () => setVisible(false));
    return () => { unsubOpen(); unsubClose(); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); dispatch('vtt:sheet:closed', {}); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!visible) return null;

  const hitDie = HIT_DICE[character.class] ?? 8;
  const hp = hitDie + modNum(character.stats.con);

  const portraitCharId = character.portraitPath
    ? character.portraitPath.split('/')[1] ?? character.id
    : character.id;
  const portraitUrl = character.portraitPath
    ? `${API}/api/campaigns/${character.campaignId}/party/${portraitCharId}/portrait`
    : null;

  return (
    <div className="sheet-scrim">
      <div className="sheet-panel">
        <div className="sheet-topbar">
          {portraitUrl
            ? <img className="sheet-portrait" src={portraitUrl} alt={character.name} />
            : <div className="sheet-portrait-placeholder" />
          }
          <div className="sheet-identity">
            <p className="sheet-name">{character.name}</p>
            <p className="sheet-subtitle">{character.class} · {character.species} · {character.background}</p>
          </div>
          <div className="sheet-hp">
            <div className="sheet-hp-value">{hp}</div>
            <div className="sheet-hp-label">Max HP</div>
          </div>
          <button className="sheet-close" onClick={() => dispatch('vtt:sheet:closed', {})} aria-label="Close">×</button>
        </div>

        <div className="sheet-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`sheet-tab${tab === t.id ? ' sheet-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="sheet-content">
          {tab === 'abilities' && <AbilitiesTab character={character} />}
          {tab === 'features'  && <FeaturesTab  character={character} />}
          {tab === 'inventory' && <InventoryTab />}
        </div>
      </div>
    </div>
  );
}
