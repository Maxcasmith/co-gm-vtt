import { useEffect, useState } from 'react';
import type { Character, Weapon, Consumable, TurnOrderEntry } from 'shared';
import { isWeapon, isConsumable, CLASS_WEAPON_PROFS, CLASS_ARMOR_TRAINING, calcAC } from 'shared';
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

function profBonusForLevel(level: number): number {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9)  return 4;
  if (level >= 5)  return 3;
  return 2;
}

function mod(score: number): string {
  const m = Math.floor((score - 10) / 2);
  return m >= 0 ? `+${m}` : `${m}`;
}
function modNum(score: number) { return Math.floor((score - 10) / 2); }

const STAT_KEYS: Array<keyof Character['stats']> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

type SheetTab = 'abilities' | 'features' | 'inventory';

interface Props { character: Character; currentHp?: number; maxHp?: number; }

// ── Abilities ─────────────────────────────────────────────────────────────────

function AbilitiesTab({ character }: { character: Character }) {
  const PROF = character.proficiencyBonus ?? profBonusForLevel(character.level ?? 1);
  const [deathSuccesses, setDeathSuccesses] = useState(0);
  const [deathFailures, setDeathFailures]   = useState(0);

  function rollDeathSave() {
    const roll = Math.floor(Math.random() * 20) + 1;
    let msg: string;
    if (roll === 20) {
      setDeathSuccesses(3);
      msg = `(Death Save) ${character.name} rolls a 20 — miraculous recovery!`;
    } else if (roll === 1) {
      setDeathFailures(f => Math.min(3, f + 2));
      msg = `(Death Save) ${character.name} rolls a 1 — two failures!`;
    } else if (roll >= 10) {
      setDeathSuccesses(s => Math.min(3, s + 1));
      msg = `(Death Save) ${character.name} rolls ${roll} — success.`;
    } else {
      setDeathFailures(f => Math.min(3, f + 1));
      msg = `(Death Save) ${character.name} rolls ${roll} — failure.`;
    }
    dispatch('vtt:chat:message-sent', { text: msg, senderName: character.name, timestamp: Date.now() });
  }

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

          <button className="sheet-save-row sheet-save-row--clickable" onClick={rollDeathSave} title="Roll death saving throw">
            <span className="sheet-save-dot" />
            <span className="sheet-save-label">DEATH</span>
            <span className="sheet-save-val">d20</span>
          </button>

          <div className="sheet-death-saves">
            <progress className="sheet-death-bar sheet-death-bar--life"  max={3} value={deathSuccesses} />
            <progress className="sheet-death-bar sheet-death-bar--death" max={3} value={deathFailures} />
          </div>

          <p className="sheet-section-title" style={{ paddingTop: '15px' }}>Proficiencies &amp; Training</p>
          <div className="sheet-proficiency-block">
            <div className="sheet-proficiency-row">
              <span className="sheet-proficiency-label">Weapons</span>
              <span className="sheet-proficiency-value">
                {(CLASS_WEAPON_PROFS[character.class] ?? []).length > 0
                  ? (CLASS_WEAPON_PROFS[character.class] ?? []).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' & ') + ' weapons'
                  : 'None'}
              </span>
            </div>
            <div className="sheet-proficiency-row">
              <span className="sheet-proficiency-label">Armor</span>
              <span className="sheet-proficiency-value">
                {(CLASS_ARMOR_TRAINING[character.class] ?? []).length > 0
                  ? (CLASS_ARMOR_TRAINING[character.class] ?? []).map(a => a.charAt(0).toUpperCase() + a.slice(1)).join(', ')
                  : 'None'}
              </span>
            </div>
          </div>
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

const WEAPON_NAMES    = /sword|dagger|axe|mace|staff|bow|spear|lance|rapier|club|flail|hammer|trident|whip|blade/i;
const ARMOUR_NAMES    = /armou?r|shield|helmet|gauntlet|boot|plate|chain|mail/i;
const CONSUMABLE_NAMES = /potion|scroll|ration|herb|tincture|elixir/i;

const SECTIONS = [
  { label: 'Weapons',     test: (i: Item | Weapon | Consumable) => isWeapon(i)      || WEAPON_NAMES.test(i.name)     },
  { label: 'Armour',      test: (i: Item | Weapon | Consumable) => ARMOUR_NAMES.test(i.name)                         },
  { label: 'Consumables', test: (i: Item | Weapon | Consumable) => isConsumable(i)  || CONSUMABLE_NAMES.test(i.name) },
  { label: 'Other',       test: () => true                                                                            },
] as const;

function asWeapon(item: Item | Weapon | Consumable): Weapon {
  if (isWeapon(item)) return item;
  return { ...item, type: 'weapon' as const, damage: '1d8', damageType: 'slashing', attackBonus: 0, range: 5, properties: [] };
}

function asConsumable(item: Item | Weapon | Consumable): Consumable {
  if (isConsumable(item)) return item;
  return { ...item, type: 'consumable' as const, effect: '', actionCost: 'bonusAction' };
}

function InventoryTab({ character, combatActive, isMyTurn, actionAvailable }: { character: Character; combatActive: boolean; isMyTurn: boolean; actionAvailable: boolean }) {
  const items = character.inventory ?? [];

  function handleWeaponClick(weapon: Weapon) {
    if (!isMyTurn || !actionAvailable) return;
    dispatch('vtt:sheet:closed', {});
    dispatch('vtt:targeting:start', { weapon, actionType: 'action' });
  }

  function handleConsumableClick(item: Consumable) {
    dispatch('vtt:sheet:closed', {});
    dispatch('vtt:consumable:used', { item, characterId: character.id });
  }

  // Assign each item to its first matching section
  const grouped = new Map<string, Array<Item | Weapon | Consumable>>();
  for (const item of items) {
    const section = SECTIONS.find(s => s.test(item))!;
    const bucket = grouped.get(section.label) ?? [];
    bucket.push(item);
    grouped.set(section.label, bucket);
  }

  return (
    <>
      {character.gold != null && (
        <div className="sheet-inv-gold">
          <span className="sheet-inv-gold-label">Gold</span>
          <span className="sheet-inv-gold-value">{character.gold} gp</span>
        </div>
      )}
      {items.length === 0
        ? <div className="sheet-empty">
            <p className="sheet-empty-title">No items yet</p>
            <p className="sheet-empty-hint">Items will appear here as you acquire them</p>
          </div>
        : SECTIONS.map(section => {
            const bucket = grouped.get(section.label);
            if (!bucket?.length) return null;
            return (
              <div key={section.label} className="sheet-inv-section">
                <p className="sheet-inv-section-title">{section.label}</p>
                <div className="sheet-inventory">
                  {bucket.map(item => {
                    const weapon     = combatActive && section.label === 'Weapons'     ? asWeapon(item)     : null;
                    const consumable = combatActive && section.label === 'Consumables' ? asConsumable(item) : null;
                    const clickable  = weapon ? (isMyTurn && actionAvailable) : !!consumable;
                    return (
                      <div
                        key={item.id}
                        className={`sheet-inv-card${weapon ? ' sheet-inv-card--weapon' : ''}${consumable ? ' sheet-inv-card--consumable' : ''}${(weapon || consumable) && !clickable ? ' sheet-inv-card--disabled' : ''}`}
                        onClick={weapon ? () => handleWeaponClick(weapon) : consumable ? () => handleConsumableClick(consumable) : undefined}
                      >
                        <div className="sheet-inv-card-header">
                          <span className="sheet-inv-name">{item.name}</span>
                          {item.quantity > 1 && <span className="sheet-inv-qty">×{item.quantity}</span>}
                        </div>
                        {item.description && <p className="sheet-inv-desc">{item.description}</p>}
                        {weapon     && <span className="sheet-inv-attack">Attack</span>}
                        {consumable && <span className="sheet-inv-use">Use</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
      }
    </>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

const TABS: { id: SheetTab; label: string }[] = [
  { id: 'abilities', label: 'Abilities' },
  { id: 'features',  label: 'Features'  },
  { id: 'inventory', label: 'Inventory' },
];

// XP required to reach each level (index = level, so index 1 = 300 XP to reach level 2)
const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

export default function CharacterSheetOverlay({ character, currentHp, maxHp }: Props) {
  const [visible, setVisible] = useState(false);
  const [tab, setTab]         = useState<SheetTab>('abilities');
  const [combatActive, setCombatActive]     = useState(false);
  const [isMyTurn, setIsMyTurn]             = useState(false);
  const [actionAvailable, setActionAvailable] = useState(true);
  useEffect(() => on('vtt:combat:state', ({ active }) => {
    setCombatActive(active);
    if (!active) { setIsMyTurn(false); setActionAvailable(true); }
  }), []);
  useEffect(() => on('vtt:combat:turn', ({ actorName }) => {
    const mine = actorName === character.name;
    setIsMyTurn(mine);
    if (mine) setActionAvailable(true);
  }), [character.name]);
  useEffect(() => on('vtt:combat:action:spent', () => setActionAvailable(false)), []);
  const [currentXp, setCurrentXp] = useState(character.xp ?? 0);
  const [currentLevel, setCurrentLevel] = useState(character.level ?? 1);
  const [profBonus, setProfBonus] = useState(character.proficiencyBonus ?? profBonusForLevel(character.level ?? 1));
  useEffect(() => { setCurrentXp(character.xp ?? 0); }, [character.xp]);
  useEffect(() => {
    setCurrentLevel(character.level ?? 1);
    setProfBonus(character.proficiencyBonus ?? profBonusForLevel(character.level ?? 1));
  }, [character.level, character.proficiencyBonus]);

  async function handleLevelUp() {
    const newLevel = currentLevel + 1;
    const newProf = profBonusForLevel(newLevel);
    setCurrentLevel(newLevel);
    setProfBonus(newProf);
    await fetch(`${API}/api/campaigns/${character.campaignId}/party/${character.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: newLevel, proficiencyBonus: newProf }),
    });
  }

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

  const hitDie   = HIT_DICE[character.class] ?? 8;
  const derivedMaxHp = hitDie + modNum(character.stats.con);
  const displayMax     = maxHp     ?? derivedMaxHp;
  const displayCurrent = currentHp ?? displayMax;

  const ac = calcAC(character);

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
          <button
            className={`sheet-initiative-btn${!combatActive ? ' sheet-initiative-btn--disabled' : ''}`}
            disabled={!combatActive}
            onClick={combatActive ? () => {
              const dexMod = modNum(character.stats.dex);
              const roll   = Math.floor(Math.random() * 20) + 1;
              const entry: TurnOrderEntry = { id: character.id, name: character.name, initiative: roll + dexMod, isPlayer: true };
              dispatch('vtt:combat:initiative:roll', { entry });
              dispatch('vtt:sheet:closed', {});
            } : undefined}
          >
            Initiative
          </button>
          <button
            className={`sheet-rest-btn${combatActive ? ' sheet-rest-btn--disabled' : ''}`}
            disabled={combatActive}
            onClick={combatActive ? undefined : () => { dispatch('vtt:sheet:closed', {}); dispatch('vtt:rest:open', {}); }}
          >
            Rest
          </button>
          <button className="sheet-close" onClick={() => dispatch('vtt:sheet:closed', {})} aria-label="Close">×</button>
        </div>

        <div className="sheet-hp-strip">
          <span className="sheet-hp-strip-label">HP</span>
          <span className={`sheet-hp-strip-value${displayCurrent < displayMax ? ' sheet-hp-strip-value--damaged' : ''}`}>{displayCurrent} / {displayMax}</span>
          <span className="sheet-hp-strip-sep" />
          <span className="sheet-hp-strip-label">AC</span>
          <span className="sheet-hp-strip-value">{ac}</span>
          <span className="sheet-hp-strip-sep" />
          <span className="sheet-hp-strip-label">INIT</span>
          <span className="sheet-hp-strip-value">{(() => { const n = modNum(character.stats.dex) + (character.initiativeBonus ?? 0); return n >= 0 ? `+${n}` : `${n}`; })()}</span>
          <span className="sheet-hp-strip-sep" />
          <span className="sheet-hp-strip-label">PROF</span>
          <span className="sheet-hp-strip-value">+{profBonus}</span>
          {(() => {
            const nextThreshold = XP_THRESHOLDS[currentLevel] ?? null;
            const canLevel = nextThreshold !== null && currentXp >= nextThreshold && currentLevel < 20;
            const levelFloor = XP_THRESHOLDS[currentLevel - 1] ?? 0;
            const barMax = nextThreshold !== null ? nextThreshold - levelFloor : 1;
            const barVal = nextThreshold !== null ? Math.min(currentXp - levelFloor, barMax) : barMax;
            return (
              <div className="sheet-xp">
                <progress className="sheet-xp-bar" max={barMax} value={barVal} />
                <span className="sheet-xp-label">
                  {currentXp.toLocaleString()} / {nextThreshold !== null ? nextThreshold.toLocaleString() : '—'} XP
                </span>
                {currentLevel < 20 && (
                  <button
                    className={`sheet-levelup-btn${canLevel ? ' sheet-levelup-btn--ready' : ''}`}
                    disabled={!canLevel}
                    onClick={() => void handleLevelUp()}
                  >LEVEL UP</button>
                )}
              </div>
            );
          })()}
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
          {tab === 'inventory' && <InventoryTab character={character} combatActive={combatActive} isMyTurn={isMyTurn} actionAvailable={actionAvailable} />}
        </div>
      </div>
    </div>
  );
}
