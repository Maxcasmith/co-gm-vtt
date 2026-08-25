import { useState, useEffect, useRef } from 'react';
import type { Character, Weapon } from 'shared';
import { actionCostFromCastingTime, isWeapon, hasOriginFeat, ABILITY_DEFS, resourceCurrent, resourceMax } from 'shared';
import { dispatch, on } from './events.ts';
import type { TargetingStartPayload } from './events.ts';
import emptyFrameIcon from './assets/icons/Icon-Frame-Blue.jpg';
import fistIcon from './assets/icons/Icon-Frame-Fist.jpg';
import './app.css';

interface Props {
  character: Character;
  combatActive: boolean;
  movementRemaining: number;
  playerCurrentHp?: number;
  /** HUD actions unlocked this turn by an active actionUnlock hook (Expeditious Retreat, Jump) — see ACTION_UNLOCKS below. */
  activeBuffs?: string[];
  /** Height off the ground (Feather Fall, falling damage) — see combat:elevation:set. */
  elevationFt?: number;
  /** Origin feat Alert's swap clause — connected players' names, and name→characterId, for the ally picker. */
  connectedAllies?: string[];
  allyCharacterIds?: Record<string, string>;
}

// Generic table for actionUnlock's `action` strings (server, ActionUnlockHook) — a future feat
// just adds a row here and sets its hook's `action` to match, no new plumbing.
const ACTION_UNLOCKS = {
  'dash-bonus': { label: 'Dash (Bonus)', cost: 'bonusAction' as const, grantFt: (speed: number) => speed },
  'jump':       { label: 'Jump',         cost: 'movement10'  as const, grantFt: () => 30 },
} satisfies Record<string, { label: string; cost: 'bonusAction' | 'movement10'; grantFt: (speed: number) => number }>;

const PIPS = [
  { key: 'action',      title: 'Action'       },
  { key: 'bonusAction', title: 'Bonus Action' },
  { key: 'reaction',    title: 'Reaction'     },
] as const;

type PipKey = typeof PIPS[number]['key'];
type Resources = Record<PipKey, boolean>;

const ALL_AVAILABLE: Resources = { action: true, bonusAction: true, reaction: true };

const STANDARD_ACTIONS = [
  { key: 'dash',      label: 'Dash'      },
  { key: 'dodge',     label: 'Dodge',     effect: 'Dodging'     },
  { key: 'disengage', label: 'Disengage', effect: 'Disengaging' },
  { key: 'hide',      label: 'Hide',      effect: 'Hiding'      },
] as const;

// Unarmed Strike — everyone can throw a punch (2024 PHB base: 1 + Strength damage, d20 +
// Strength to hit). Tavern Brawler bumps the damage die to 1d4 (server adds the Push separately,
// gated on the feat). 'simple' tags it so the server's proficiency check (every class has
// 'simple' in CLASS_WEAPON_PROFS) grants proficiency bonus on it.
function unarmedStrikeFor(character: Character): Weapon {
  return {
    id: 'unarmed-strike', name: 'Unarmed Strike', description: 'A bare-handed strike.', quantity: 1,
    type: 'weapon', damage: hasOriginFeat(character, 'Tavern Brawler') ? '1d4' : '1',
    damageType: 'bludgeoning', attackBonus: 0, range: 5, properties: ['simple'], isFinesse: false,
    iconPath: fistIcon,
  };
}

function storageKey(id: string) { return `vtt-resources:${id}`; }

function loadResources(id: string): Resources {
  try {
    const raw = sessionStorage.getItem(storageKey(id));
    return raw ? (JSON.parse(raw) as Resources) : ALL_AVAILABLE;
  } catch { return ALL_AVAILABLE; }
}

function saveResources(id: string, r: Resources) {
  sessionStorage.setItem(storageKey(id), JSON.stringify(r));
}

export default function CombatDock({ character, combatActive, movementRemaining, playerCurrentHp, activeBuffs = [], elevationFt = 0, connectedAllies = [], allyCharacterIds = {} }: Props) {
  const [resources, setResources] = useState<Resources>(() =>
    combatActive ? loadResources(character.id) : ALL_AVAILABLE
  );
  const [targeting, setTargeting] = useState<TargetingStartPayload | null>(null);
  const targetingRef = useRef<TargetingStartPayload | null>(null);
  const [activeEffects, setActiveEffects] = useState<string[]>([]);
  const [isMyTurn, setIsMyTurn] = useState(false);
  // Selected item name for a "pick a name" ability (Tinker's Magic) — keyed by ability key.
  const [chosenItems, setChosenItems] = useState<Record<string, string>>({});
  // Selected HP amount for a "spend up to what's left" ability (Lay on Hands) — keyed by ability key.
  const [chosenAmounts, setChosenAmounts] = useState<Record<string, number>>({});
  // Armed by the player before clicking a weapon — spent on that attack roll for Advantage.
  const [luckArmed, setLuckArmed] = useState(false);
  const [inspirationArmed, setInspirationArmed] = useState(false);
  // Origin feat Alert's swap clause — once per combat; the server is the real gate (Participant.alertSwapUsed),
  // this is just an optimistic lockout so the picker doesn't stay offered after a request is sent.
  const [alertSwapRequested, setAlertSwapRequested] = useState(false);
  const [allyPicker, setAllyPicker] = useState(false);
  // Origin feat Healer — which ally (or self) to tend with a Healer's Kit charge.
  const [healerPicker, setHealerPicker] = useState(false);

  // When combat ends, clear storage and reset
  useEffect(() => {
    if (!combatActive) {
      sessionStorage.removeItem(storageKey(character.id));
      targetingRef.current = null;
      setTargeting(null);
      setIsMyTurn(false);
      setLuckArmed(false);
      setInspirationArmed(false);
      setAlertSwapRequested(false);
      setAllyPicker(false);
      setHealerPicker(false);
    }
  }, [combatActive, character.id]);

  // Reset resources + effects at the START of your turn; update turn flag for all turns
  useEffect(() => on('vtt:combat:turn', ({ actorName }) => {
    const mine = actorName === character.name;
    setIsMyTurn(mine);
    if (mine) {
      setResources(ALL_AVAILABLE);
      saveResources(character.id, ALL_AVAILABLE);
      setActiveEffects([]);
    }
  }), [character.name, character.id]);

  useEffect(() => on('vtt:combat:attack', () => {
    const t = targetingRef.current;
    spendResource(t?.kind === 'weapon' ? t.actionType : 'action');
    // Bundled smite (e.g. Divine Smite) spends its own bonus action on top of the attack's action.
    if (t?.kind === 'weapon' && t.bonusSpell) spendResource('bonusAction');
    setTargeting(null);
    setLuckArmed(false);
    setInspirationArmed(false);
  }), [character.id]);

  useEffect(() => on('vtt:combat:spell:attack', ({ spell }) => {
    spendResource(actionCostFromCastingTime(spell.castingTime) ?? 'action');
    setTargeting(null);
  }), [character.id]);

  useEffect(() => on('vtt:combat:spell:cast', ({ spell }) => {
    spendResource(actionCostFromCastingTime(spell.castingTime) ?? 'action');
    setTargeting(null);
  }), [character.id]);

  useEffect(() => on('vtt:combat:ability:use', ({ abilityKey }) => {
    spendResource(ABILITY_DEFS[abilityKey]?.actionCost ?? 'action');
    setTargeting(null);
  }), [character.id]);

  useEffect(() => on('vtt:consumable:used', ({ item }) => {
    setResources(prev => {
      const next = { ...prev, [item.actionCost]: false };
      saveResources(character.id, next);
      return next;
    });
    if (item.actionCost === 'action') dispatch('vtt:combat:action:spent', {});
  }), [character.id]);

  // The server owns the action economy — it refills on turn start and spends on every action it
  // accepts, including reactions spent mid-attack by a Shield-style hook that this client never
  // initiated. The local spends above stay as optimistic prediction for responsiveness; this
  // reconciles them against the authority whenever it reports.
  useEffect(() => on('vtt:combat:player:resources', payload => {
    if (payload.characterId !== character.id) return;
    const next: Resources = {
      action: payload.actionsRemaining > 0,
      bonusAction: payload.bonusActionsRemaining > 0,
      reaction: payload.reactionsRemaining > 0,
    };
    setResources(next);
    saveResources(character.id, next);
  }), [character.id]);

  useEffect(() => on('vtt:targeting:start', payload => { targetingRef.current = payload; setTargeting(payload); }), []);
  useEffect(() => on('vtt:targeting:cancel', () => { targetingRef.current = null; setTargeting(null); }), []);

  if (!combatActive) return null;

  const isDown = (playerCurrentHp ?? Infinity) <= 0;
  const isFlying = character.conditions?.some(c => c.name === 'Flying') ?? false;
  const baseSpeed = character.speed ?? 30;
  const actionsDisabled = !isMyTurn || isDown;

  const equippedWeapons = [character.equipment?.mainHand, character.equipment?.offHand]
    .filter((id, i, arr): id is string => !!id && arr.indexOf(id) === i)
    .map(id => character.inventory?.find(item => item.id === id))
    .filter((item): item is Weapon => !!item && isWeapon(item));
  equippedWeapons.push(unarmedStrikeFor(character));

  // Two-Weapon Fighting: both hands hold a weapon, neither two-handed — offers a bonus-action
  // attack with the off-hand weapon. The Two-Weapon Fighting style (added to damage) is checked
  // server-side; every dual-wielder gets the extra attack regardless of style, per RAW.
  const mainHandItem = character.inventory?.find(item => item.id === character.equipment?.mainHand);
  const offHandItem = character.inventory?.find(item => item.id === character.equipment?.offHand);
  const offhandWeapon = (mainHandItem && offHandItem && isWeapon(mainHandItem) && isWeapon(offHandItem)
    && !mainHandItem.twoHanded && !offHandItem.twoHanded) ? offHandItem : undefined;

  const availableAbilities = Object.entries(ABILITY_DEFS).filter(([, a]) => a.class === character.class);

  function handleWeaponClick(weapon: Weapon) {
    if (actionsDisabled || !resources.action) return;
    dispatch('vtt:sheet:closed', {});
    dispatch('vtt:targeting:start', { kind: 'weapon', weapon, actionType: 'action', ...(luckArmed ? { useLuckPoint: true } : {}), ...(inspirationArmed ? { useInspiration: true } : {}) });
  }

  function handleOffhandClick(weapon: Weapon) {
    if (actionsDisabled || !resources.bonusAction) return;
    dispatch('vtt:sheet:closed', {});
    dispatch('vtt:targeting:start', { kind: 'weapon', weapon, actionType: 'bonusAction', isOffhand: true, ...(luckArmed ? { useLuckPoint: true } : {}), ...(inspirationArmed ? { useInspiration: true } : {}) });
  }

  function handleAbilityClick(key: string, ability: (typeof ABILITY_DEFS)[string]) {
    if (actionsDisabled || !resources[ability.actionCost]) return;
    if (resourceCurrent(character, ability.resourceKey) <= 0) return;
    dispatch('vtt:sheet:closed', {});
    const pool = resourceCurrent(character, ability.resourceKey);
    const chosenAmount = ability.amountChoice ? (chosenAmounts[key] ?? pool) : undefined;
    if (ability.target === 'self') {
      const chosenItem = ability.itemChoices?.length ? (chosenItems[key] ?? ability.itemChoices[0]) : undefined;
      dispatch('vtt:combat:ability:use', { casterId: character.id, casterName: character.name, abilityKey: key, targetId: character.id, ...(chosenItem ? { chosenItem } : {}), ...(chosenAmount !== undefined ? { chosenAmount } : {}) });
    } else {
      dispatch('vtt:targeting:start', { kind: 'ability', abilityKey: key, label: ability.label, casterId: character.id, actionCost: ability.actionCost, ...(chosenAmount !== undefined ? { chosenAmount } : {}) });
    }
  }

  function spendResource(key: PipKey) {
    setResources(prev => {
      const next = { ...prev, [key]: false };
      saveResources(character.id, next);
      return next;
    });
    const eventForKey = { action: 'vtt:combat:action:spent', bonusAction: 'vtt:combat:bonusAction:spent', reaction: 'vtt:combat:reaction:spent' } as const;
    dispatch(eventForKey[key], {});
  }

  function handleStandardAction(action: typeof STANDARD_ACTIONS[number]) {
    if (actionsDisabled || !resources.action) return;
    spendResource('action');
    if (action.key === 'dash') {
      dispatch('vtt:movement:gained', { ft: baseSpeed });
    } else if ('effect' in action && action.effect) {
      setActiveEffects(prev => prev.includes(action.effect) ? prev : [...prev, action.effect]);
    }
    if (action.key === 'disengage') dispatch('vtt:combat:disengage', { actorId: character.id });
  }

  // Restrained can come from a plain trap (Snare, no escape mechanic — you're stuck until
  // manually freed) or a skill-check-escapable spell (Ensnaring Strike, Entangle). The client
  // can't tell which without knowing the hook that applied it, so this always offers the
  // attempt; the server silently no-ops (refunding nothing, since it checks before spending) if
  // there's no escapeSkillCheck hook to roll against.
  const isRestrained = character.conditions?.some(c => c.name === 'Restrained') ?? false;

  function handleEscapeAttempt() {
    if (actionsDisabled || !resources.action) return;
    spendResource('action');
    dispatch('vtt:condition:escape:attempt', { targetId: character.id, name: 'Restrained' });
  }

  function handleActionUnlock(kind: keyof typeof ACTION_UNLOCKS) {
    const unlock = ACTION_UNLOCKS[kind];
    if (actionsDisabled) return;
    if (unlock.cost === 'bonusAction') {
      if (!resources.bonusAction) return;
      spendResource('bonusAction');
    } else {
      if (movementRemaining < 10) return;
      dispatch('vtt:movement:used', { ft: 10 });
    }
    dispatch('vtt:movement:gained', { ft: unlock.grantFt(baseSpeed) });
  }

  function handleElevationChange(deltaFt: number) {
    dispatch('vtt:combat:elevation:set', { targetId: character.id, elevationFt: Math.max(0, elevationFt + deltaFt) });
  }

  function handleAlertSwap(allyName: string) {
    const targetId = allyCharacterIds[allyName];
    if (!targetId) return;
    dispatch('vtt:combat:alert:swap', { characterId: character.id, targetId });
    setAlertSwapRequested(true);
    setAllyPicker(false);
  }

  function handleHealerKit(targetId: string) {
    if (actionsDisabled || !resources.action) return;
    dispatch('vtt:combat:healerKit:use', { casterId: character.id, casterName: character.name, targetId });
    setHealerPicker(false);
  }

  if (isDown) {
    return (
      <div className="combat-dock-wrapper">
        <div className="combat-dock combat-dock--down">
          <span className="combat-dock-down-label">
            {isMyTurn ? 'Making death save…' : 'Unconscious'}
          </span>
          <div className="combat-dock-down-saves" />
        </div>
      </div>
    );
  }

  const weaponsUsable = !actionsDisabled && resources.action;

  const luckPoints = hasOriginFeat(character, 'Lucky') ? resourceCurrent(character, 'luckPoints') : 0;
  const alertAllies = connectedAllies.filter(name => name !== character.name && allyCharacterIds[name]);
  const canOfferAlertSwap = hasOriginFeat(character, 'Alert') && !alertSwapRequested && alertAllies.length > 0;
  const healersKit = character.inventory?.find(i => i.name === "Healer's Kit" && i.quantity > 0);
  const healerTargets = [
    { name: character.name, id: character.id },
    ...connectedAllies.filter(name => name !== character.name && allyCharacterIds[name]).map(name => ({ name, id: allyCharacterIds[name]! })),
  ];
  const canUseHealerKit = hasOriginFeat(character, 'Healer') && !!healersKit && weaponsUsable;

  return (
  <div className="combat-dock-wrapper">
    <div className="combat-dock-column">
      {canOfferAlertSwap && (
        allyPicker ? (
          <div className="combat-dock-alert-picker">
            {alertAllies.map(name => (
              <button key={name} className="combat-dock-luck-toggle" onClick={() => handleAlertSwap(name)}>
                Swap with {name}
              </button>
            ))}
            <button className="combat-dock-luck-toggle" onClick={() => setAllyPicker(false)}>Cancel</button>
          </div>
        ) : (
          <button
            className="combat-dock-luck-toggle"
            title="Swap your rolled Initiative with a willing ally's — once per combat"
            onClick={() => setAllyPicker(true)}
          >
            Swap Initiative
          </button>
        )
      )}
      {canUseHealerKit && (
        healerPicker ? (
          <div className="combat-dock-alert-picker">
            {healerTargets.map(t => (
              <button key={t.id} className="combat-dock-luck-toggle" onClick={() => handleHealerKit(t.id)}>
                Tend {t.name === character.name ? 'self' : t.name}
              </button>
            ))}
            <button className="combat-dock-luck-toggle" onClick={() => setHealerPicker(false)}>Cancel</button>
          </div>
        ) : (
          <button
            className="combat-dock-luck-toggle"
            title="Expend a Healer's Kit use to tend a creature within 5ft"
            onClick={() => setHealerPicker(true)}
          >
            Healer's Kit ({healersKit?.quantity})
          </button>
        )
      )}
      {luckPoints > 0 && (
        <button
          className={`combat-dock-luck-toggle${luckArmed ? ' combat-dock-luck-toggle--active' : ''}`}
          title="Spend a Luck Point on your next attack roll for Advantage"
          onClick={() => setLuckArmed(prev => !prev)}
        >
          Luck ({luckPoints}){luckArmed ? ' — armed' : ''}
        </button>
      )}
      {character.heroicInspiration && (
        <button
          className={`combat-dock-luck-toggle${inspirationArmed ? ' combat-dock-luck-toggle--active' : ''}`}
          title="Spend Heroic Inspiration on your next attack roll for Advantage"
          onClick={() => setInspirationArmed(prev => !prev)}
        >
          Inspiration{inspirationArmed ? ' — armed' : ''}
        </button>
      )}
      {(equippedWeapons.length > 0 || offhandWeapon || availableAbilities.length > 0) && (
        <div className="combat-dock-weapons">
          {equippedWeapons.map(weapon => (
            <button
              key={weapon.id}
              data-action-cost="action"
              className={`combat-dock-weapon-btn${!weaponsUsable ? ' combat-dock-weapon-btn--spent' : ''}${targeting?.kind === 'weapon' && targeting.weapon.id === weapon.id ? ' combat-dock-weapon-btn--active' : ''}`}
              title={weapon.name}
              onClick={() => handleWeaponClick(weapon)}
            >
              <img className="combat-dock-weapon-icon" src={weapon.iconPath || emptyFrameIcon} alt="" />
            </button>
          ))}
          {offhandWeapon && (
            <button
              key={`offhand:${offhandWeapon.id}`}
              data-action-cost="bonusAction"
              className={`combat-dock-weapon-btn${(actionsDisabled || !resources.bonusAction) ? ' combat-dock-weapon-btn--spent' : ''}${targeting?.kind === 'weapon' && targeting.isOffhand ? ' combat-dock-weapon-btn--active' : ''}`}
              title={`${offhandWeapon.name} (off-hand)`}
              onClick={() => handleOffhandClick(offhandWeapon)}
            >
              <img className="combat-dock-weapon-icon" src={offhandWeapon.iconPath || emptyFrameIcon} alt="" />
            </button>
          )}
          {availableAbilities.map(([key, ability]) => (
            <div className="combat-dock-ability-group" key={key}>
              {!!ability.itemChoices?.length && (
                <select
                  className="combat-dock-ability-select"
                  value={chosenItems[key] ?? ability.itemChoices[0]}
                  onChange={e => setChosenItems(prev => ({ ...prev, [key]: e.target.value }))}
                >
                  {ability.itemChoices.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
              )}
              {ability.amountChoice && (
                <input
                  type="number"
                  className="combat-dock-ability-select"
                  min={1}
                  max={Math.max(1, resourceCurrent(character, ability.resourceKey))}
                  value={chosenAmounts[key] ?? resourceCurrent(character, ability.resourceKey)}
                  onChange={e => setChosenAmounts(prev => ({ ...prev, [key]: Math.max(1, Math.min(Number(e.target.value) || 1, resourceCurrent(character, ability.resourceKey))) }))}
                />
              )}
              <button
                data-action-cost={ability.actionCost}
                className={`combat-dock-ability-btn${(actionsDisabled || !resources[ability.actionCost] || resourceCurrent(character, ability.resourceKey) <= 0) ? ' combat-dock-ability-btn--spent' : ''}${targeting?.kind === 'ability' && targeting.abilityKey === key ? ' combat-dock-ability-btn--active' : ''}`}
                title={ability.label}
                onClick={() => handleAbilityClick(key, ability)}
              >
                <img className="combat-dock-weapon-icon" src={emptyFrameIcon} alt={ability.label} />
              </button>
              <span className="combat-dock-ability-uses">{resourceCurrent(character, ability.resourceKey)}/{resourceMax(character, ability.resourceKey)}</span>
            </div>
          ))}
        </div>
      )}
    <div className="combat-dock">
      <div className="combat-dock-pips">
        {PIPS.map(pip => (
          <div
            key={pip.key}
            data-resource={pip.key}
            data-active={targeting !== null && pip.key === (targeting.kind === 'ability' ? targeting.actionCost : targeting.actionType) ? 'true' : undefined}
            className={`combat-pip${!resources[pip.key] ? ' combat-pip--spent' : ''}`}
            title={pip.title}
          />
        ))}
        <span className="combat-dock-speed">{movementRemaining}ft</span>
        {elevationFt > 0 && (
          <span className="combat-dock-elevation" title="Height off the ground">
            {isFlying && <button type="button" onClick={() => handleElevationChange(-10)} disabled={elevationFt <= 0}>-</button>}
            {elevationFt}ft ↑
            {isFlying && <button type="button" onClick={() => handleElevationChange(10)}>+</button>}
          </span>
        )}
      </div>

      <div className={`combat-dock-actions${actionsDisabled ? ' combat-dock-actions--disabled' : ''}`}>
        {STANDARD_ACTIONS.map(action => (
          <button
            key={action.key}
            className={`combat-action-btn combat-action-btn--standard${(actionsDisabled || !resources.action) ? ' combat-action-btn--spent' : ''}`}
            onClick={() => handleStandardAction(action)}
          >
            {action.label}
            <span className="combat-action-btn-cost" />
          </button>
        ))}
        {isRestrained && (
          <button
            className={`combat-action-btn combat-action-btn--standard${(actionsDisabled || !resources.action) ? ' combat-action-btn--spent' : ''}`}
            onClick={handleEscapeAttempt}
          >
            Escape
            <span className="combat-action-btn-cost" />
          </button>
        )}
        {activeBuffs.filter((kind): kind is keyof typeof ACTION_UNLOCKS => kind in ACTION_UNLOCKS).map(kind => {
          const unlock = ACTION_UNLOCKS[kind];
          const disabled = actionsDisabled || (unlock.cost === 'bonusAction' ? !resources.bonusAction : movementRemaining < 10);
          return (
            <button
              key={kind}
              className={`combat-action-btn combat-action-btn--standard${disabled ? ' combat-action-btn--spent' : ''}`}
              onClick={() => handleActionUnlock(kind)}
            >
              {unlock.label}
              <span className="combat-action-btn-cost" />
            </button>
          );
        })}
      </div>

      {activeEffects.length > 0 && (
        <div className="combat-effects-row">
          {activeEffects.map(effect => (
            <span key={effect} className="combat-effect-badge">{effect}</span>
          ))}
        </div>
      )}
    </div>
    </div>

    <button
      className={`combat-end-turn-btn${!isMyTurn ? ' combat-end-turn-btn--waiting' : ''}`}
      onKeyDown={e => e.code === 'Space' && e.preventDefault()}
      onClick={() => isMyTurn && dispatch('vtt:combat:turn:end', {})}
    >
      {isMyTurn ? 'End Turn' : 'Waiting…'}
    </button>
  </div>
  );
}
