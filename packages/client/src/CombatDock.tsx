import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Character, Spell, Weapon } from 'shared';
import { actionCostFromCastingTime, isWeapon, hasOriginFeat, unarmedStrikeFor, monkMartialArtsActive, ABILITY_DEFS, RESOURCE_DEFS, resourceCurrent, resourceMax } from 'shared';
import { dispatch, on } from './events.ts';
import type { TargetingStartPayload } from './events.ts';
import { Button } from './components/Button/Button.tsx';
import { PipCounter } from './components/PipCounter/PipCounter.tsx';
import ItemIcon from './ItemIcon.tsx';
import InfoTooltip from './create-campaign/InfoTooltip.tsx';
import './app.css';

const API = `http://${window.location.hostname}:3001`;

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
  // Params modal for a "spend up to what's left" ability (Lay on Hands) — open when set.
  const [amountModal, setAmountModal] = useState<{ key: string; amount: number; cure: boolean } | null>(null);
  const [inspirationArmed, setInspirationArmed] = useState(false);
  // Origin feat Alert's swap clause — once per combat; the server is the real gate (Participant.alertSwapUsed),
  // this is just an optimistic lockout so the picker doesn't stay offered after a request is sent.
  const [alertSwapRequested, setAlertSwapRequested] = useState(false);
  const [allyPicker, setAllyPicker] = useState(false);
  // Origin feat Healer — which ally (or self) to tend with a Healer's Kit charge.
  const [healerPicker, setHealerPicker] = useState(false);
  // Favored Enemy has no ABILITY_DEFS entry — it's spent inside the normal spell-cast flow when
  // casting Hunter's Mark (see combat.ts), so this button just fetches that one Spell and fires
  // the same targeting:start SpellsTab uses, rather than a whole spell list on the combat HUD.
  const [huntersMark, setHuntersMark] = useState<Spell | null>(null);
  // Favored Enemy grants Hunter's Mark automatically — "prepared... doesn't count against your
  // prepared spells" (srd.ts) — so it's never in character.spells; gate on the class feature only.
  const favoredEnemyRanger = resourceMax(character, 'favoredEnemy') > 0;
  // Whether THIS character is currently concentrating on their own Hunter's Mark — redirecting an
  // active mark to a new target is a free recast (see combat.ts), so the button reads "More
  // Favored Enemy" rather than implying it'll spend another of the limited uses below.
  const [huntersMarkActive, setHuntersMarkActive] = useState(false);

  useEffect(() => {
    if (!favoredEnemyRanger) { setHuntersMark(null); return; }
    fetch(`${API}/api/spells?class=Ranger`)
      .then(r => r.json())
      .then((all: Spell[]) => setHuntersMark(all.find(s => s.name === "Hunter's Mark") ?? null))
      .catch(() => {});
  }, [favoredEnemyRanger]);

  useEffect(() => on('vtt:combat:concentration', ({ targetId, targetName, spellName }) => {
    if (targetId !== character.id && targetName !== character.name) return;
    setHuntersMarkActive(spellName === "Hunter's Mark");
  }), [character.id, character.name]);

  // When combat ends, clear storage and reset
  useEffect(() => {
    if (!combatActive) {
      sessionStorage.removeItem(storageKey(character.id));
      targetingRef.current = null;
      setTargeting(null);
      setIsMyTurn(false);
      setInspirationArmed(false);
      setAlertSwapRequested(false);
      setAllyPicker(false);
      setHealerPicker(false);
      setHuntersMarkActive(false);
    }
  }, [combatActive, character.id]);

  // Reset resources + effects at the START of your turn; update turn flag for all turns
  useEffect(() => on('vtt:combat:turn', ({ actorName, resync }) => {
    const mine = actorName === character.name;
    setIsMyTurn(mine);
    // A rejoin replay isn't a new turn — the server's resources payload already restored the real state.
    if (mine && !resync) {
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
    if (payload.activeEffects) setActiveEffects(payload.activeEffects);
  }), [character.id]);

  useEffect(() => on('vtt:targeting:start', payload => { targetingRef.current = payload; setTargeting(payload); }), []);
  useEffect(() => on('vtt:targeting:cancel', () => { targetingRef.current = null; setTargeting(null); }), []);

  if (!combatActive) return null;

  const isDown = (playerCurrentHp ?? Infinity) <= 0;
  const isFlying = character.conditions?.some(c => c.name === 'Flying') ?? false;
  const baseSpeed = character.speed ?? 30;
  const actionsDisabled = !isMyTurn || isDown;

  // Two-Weapon Fighting: both hands hold a weapon, neither two-handed — offers a bonus-action
  // attack with the off-hand weapon. The Two-Weapon Fighting style (added to damage) is checked
  // server-side; every dual-wielder gets the extra attack regardless of style, per RAW.
  const mainHandItem = character.inventory?.find(item => item.id === character.equipment?.mainHand);
  const offHandItem = character.inventory?.find(item => item.id === character.equipment?.offHand);
  const offhandWeapon = (mainHandItem && offHandItem && isWeapon(mainHandItem) && isWeapon(offHandItem)
    && !mainHandItem.twoHanded && !offHandItem.twoHanded) ? offHandItem : undefined;

  // Martial Arts' Bonus Unarmed Strike — only while unarmored, shieldless, and wielding nothing
  // but Monk weapons (or nothing); monkMartialArtsActive already carries that full RAW gate.
  const monkBonusStrike = monkMartialArtsActive(character) ? unarmedStrikeFor(character) : undefined;

  // The off-hand weapon only ever gets its own bonus-action button (above) — never also listed
  // as an action-attack option, or it'd render twice (once as an action button, once as bonus).
  const equippedWeapons = [character.equipment?.mainHand, character.equipment?.offHand]
    .filter((id, i, arr): id is string => !!id && arr.indexOf(id) === i && id !== offhandWeapon?.id)
    .map(id => character.inventory?.find(item => item.id === id))
    .filter((item): item is Weapon => !!item && isWeapon(item));
  equippedWeapons.push(unarmedStrikeFor(character));

  const availableAbilities = Object.entries(ABILITY_DEFS).filter(([, a]) => a.class === character.class);
  // Every RESOURCE_DEFS pool the character owns (Second Wind, Rage, Favored Enemy, ...) — not
  // just the ones with an ABILITY_DEFS button, so silently-spent pools (Favored Enemy's free
  // Hunter's Mark) get HUD representation too.
  const ownedResources = Object.values(RESOURCE_DEFS).filter(def => resourceMax(character, def.key) > 0);
  const huntersMarkCost = huntersMark ? (actionCostFromCastingTime(huntersMark.castingTime) ?? 'action') : undefined;
  // Which resource pool the current targeting flow is about to spend — pulses that resource's
  // pips the same way the actionType pip already pulses (see the PIPS.map data-active check).
  const activeResourceKey = targeting?.kind === 'ability'
    ? ABILITY_DEFS[targeting.abilityKey]?.resourceKey
    : (targeting?.kind === 'spell' && huntersMark && targeting.spell.name === huntersMark.name ? 'favoredEnemy' : undefined);

  function handleWeaponClick(weapon: Weapon) {
    if (actionsDisabled || !resources.action) return;
    dispatch('vtt:sheet:closed', {});
    dispatch('vtt:targeting:start', { kind: 'weapon', weapon, actionType: 'action', ...(inspirationArmed ? { useInspiration: true } : {}) });
  }

  function handleOffhandClick(weapon: Weapon) {
    if (actionsDisabled || !resources.bonusAction) return;
    dispatch('vtt:sheet:closed', {});
    dispatch('vtt:targeting:start', { kind: 'weapon', weapon, actionType: 'bonusAction', isOffhand: true, ...(inspirationArmed ? { useInspiration: true } : {}) });
  }

  // Not isOffhand — the bonus punch still gets its ability-mod damage bonus, unlike a true
  // off-hand weapon attack (see offhandStatBonus, combat.ts).
  function handleMonkBonusClick(weapon: Weapon) {
    if (actionsDisabled || !resources.bonusAction) return;
    dispatch('vtt:sheet:closed', {});
    dispatch('vtt:targeting:start', { kind: 'weapon', weapon, actionType: 'bonusAction', ...(inspirationArmed ? { useInspiration: true } : {}) });
  }

  function handleAbilityClick(key: string, ability: (typeof ABILITY_DEFS)[string]) {
    if (actionsDisabled || !resources[ability.actionCost]) return;
    const pool = resourceCurrent(character, ability.resourceKey);
    if (pool <= 0) return;
    if (ability.amountChoice) {
      setAmountModal({ key, amount: pool, cure: false });
      return;
    }
    dispatch('vtt:sheet:closed', {});
    if (ability.target === 'self') {
      const chosenItem = ability.itemChoices?.length ? (chosenItems[key] ?? ability.itemChoices[0]) : undefined;
      dispatch('vtt:combat:ability:use', { casterId: character.id, casterName: character.name, abilityKey: key, targetId: character.id, ...(chosenItem ? { chosenItem } : {}) });
    } else {
      dispatch('vtt:targeting:start', { kind: 'ability', abilityKey: key, label: ability.label, casterId: character.id, actionCost: ability.actionCost, ...(ability.includeSelf ? { includeSelf: true } : {}) });
    }
  }

  // Accept in the amount-params modal (Lay on Hands): heal for the chosen HP, or spend the
  // ability's flat cureCost to cure a condition instead — same targeting/self dispatch
  // handleAbilityClick uses for every other ability, just fed by the modal's state.
  function confirmAmountModal() {
    if (!amountModal) return;
    const { key, amount, cure } = amountModal;
    const ability = ABILITY_DEFS[key];
    setAmountModal(null);
    dispatch('vtt:sheet:closed', {});
    const chosenAmount = cure ? ability.cureCost : amount;
    if (ability.target === 'self') {
      dispatch('vtt:combat:ability:use', { casterId: character.id, casterName: character.name, abilityKey: key, targetId: character.id, chosenAmount, ...(cure ? { cureCondition: true } : {}) });
    } else {
      dispatch('vtt:targeting:start', { kind: 'ability', abilityKey: key, label: ability.label, casterId: character.id, actionCost: ability.actionCost, chosenAmount, ...(cure ? { cureCondition: true } : {}), ...(ability.includeSelf ? { includeSelf: true } : {}) });
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
    // Every standard action (Dash, Dodge, Disengage, Hide) costs the same action — the client
    // spends its own pip above for instant feedback, but the server is the resource authority
    // (see emitResources) and never heard about any of these. The next thing that queries it
    // (e.g. a bonus-action offhand attack) would report the action as still available and stomp
    // the local spend, making it look like the action "came back". One shared notification for
    // all four instead of a one-off per action, since they all spend the same resource.
    dispatch('vtt:combat:standardAction:used', { actorId: character.id, key: action.key, ...('effect' in action ? { effect: action.effect } : {}) });
    // Dash movement is granted by the server once it accepts the action spend (movement:granted).
    if ('effect' in action && action.effect) {
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

  // No resourceCurrent('favoredEnemy') <= 0 gate here — unlike an ABILITY_DEFS pool, running out
  // of free Favored Enemy casts doesn't block Hunter's Mark, it just spends a spell slot instead
  // (see combat.ts's fall-through to trySpendSpellSlot).
  function handleCastHuntersMark() {
    if (!huntersMark || !huntersMarkCost) return;
    if (actionsDisabled || !resources[huntersMarkCost]) return;
    dispatch('vtt:sheet:closed', {});
    dispatch('vtt:targeting:start', { kind: 'spell', spell: huntersMark, casterId: character.id, actionType: huntersMarkCost, casterLevel: character.level });
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

  const amountModalAbility = amountModal ? ABILITY_DEFS[amountModal.key] : undefined;
  const amountModalPool = amountModalAbility ? resourceCurrent(character, amountModalAbility.resourceKey) : 0;
  const amountModalCureCost = amountModalAbility?.cureCost;
  const amountModalCanCure = amountModalCureCost !== undefined && amountModalPool >= amountModalCureCost;
  const amountModalCanAccept = amountModal ? (amountModal.cure ? amountModalCanCure : amountModal.amount >= 1) : false;

  const alertAllies = connectedAllies.filter(name => name !== character.name && allyCharacterIds[name]);
  const canOfferAlertSwap = hasOriginFeat(character, 'Alert') && !alertSwapRequested && alertAllies.length > 0;
  const healersKit = character.inventory?.find(i => i.name === "Healer's Kit" && i.quantity > 0);
  const healerTargets = [
    { name: character.name, id: character.id },
    ...connectedAllies.filter(name => name !== character.name && allyCharacterIds[name]).map(name => ({ name, id: allyCharacterIds[name]! })),
  ];
  const canUseHealerKit = hasOriginFeat(character, 'Healer') && !!healersKit && weaponsUsable;

  return (
  <>
  <div className="combat-dock-wrapper">
    <div className="combat-dock-column">
      {canOfferAlertSwap && (
        allyPicker ? (
          <div className="combat-dock-alert-picker">
            {alertAllies.map(name => (
              <Button key={name} variant="ghost" className="combat-dock-luck-toggle" onClick={() => handleAlertSwap(name)}>
                Swap with {name}
              </Button>
            ))}
            <Button variant="ghost" className="combat-dock-luck-toggle" onClick={() => setAllyPicker(false)}>Cancel</Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            className="combat-dock-luck-toggle"
            title="Swap your rolled Initiative with a willing ally's — once per combat"
            onClick={() => setAllyPicker(true)}
          >
            Swap Initiative
          </Button>
        )
      )}
      {canUseHealerKit && (
        healerPicker ? (
          <div className="combat-dock-alert-picker">
            {healerTargets.map(t => (
              <Button key={t.id} variant="ghost" className="combat-dock-luck-toggle" onClick={() => handleHealerKit(t.id)}>
                Tend {t.name === character.name ? 'self' : t.name}
              </Button>
            ))}
            <Button variant="ghost" className="combat-dock-luck-toggle" onClick={() => setHealerPicker(false)}>Cancel</Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            data-action-cost="action"
            className="combat-dock-weapon-btn"
            title={`Healer's Kit (${healersKit?.quantity}) — expend a use to tend a creature within 5ft`}
            onClick={() => setHealerPicker(true)}
          >
            <ItemIcon className="combat-dock-weapon-icon" name="Healer's Kit" />
          </Button>
        )
      )}
      {character.heroicInspiration && (
        <Button
          variant="ghost"
          className={`combat-dock-luck-toggle${inspirationArmed ? ' combat-dock-luck-toggle--active' : ''}`}
          title="Spend Heroic Inspiration on your next attack roll for Advantage"
          onClick={() => setInspirationArmed(prev => !prev)}
        >
          Inspiration{inspirationArmed ? ' — armed' : ''}
        </Button>
      )}
      {(equippedWeapons.length > 0 || offhandWeapon || availableAbilities.length > 0 || huntersMark) && (
        <div className="combat-dock-weapons">
          {equippedWeapons.map(weapon => (
            <Button
              key={weapon.id}
              variant="ghost"
              data-action-cost="action"
              className={`combat-dock-weapon-btn${!weaponsUsable ? ' combat-dock-weapon-btn--spent' : ''}${targeting?.kind === 'weapon' && targeting.weapon.id === weapon.id ? ' combat-dock-weapon-btn--active' : ''}`}
              title={weapon.name}
              onClick={() => handleWeaponClick(weapon)}
            >
              <ItemIcon className="combat-dock-weapon-icon" name={weapon.name} iconPath={weapon.iconPath} />
            </Button>
          ))}
          {offhandWeapon && (
            <Button
              key={`offhand:${offhandWeapon.id}`}
              variant="ghost"
              data-action-cost="bonusAction"
              className={`combat-dock-weapon-btn${(actionsDisabled || !resources.bonusAction) ? ' combat-dock-weapon-btn--spent' : ''}${targeting?.kind === 'weapon' && targeting.isOffhand ? ' combat-dock-weapon-btn--active' : ''}`}
              title={`${offhandWeapon.name} (off-hand)`}
              onClick={() => handleOffhandClick(offhandWeapon)}
            >
              <ItemIcon className="combat-dock-weapon-icon" name={offhandWeapon.name} iconPath={offhandWeapon.iconPath} />
            </Button>
          )}
          {monkBonusStrike && (
            <Button
              key="monk-bonus-strike"
              variant="ghost"
              data-action-cost="bonusAction"
              className={`combat-dock-weapon-btn${(actionsDisabled || !resources.bonusAction) ? ' combat-dock-weapon-btn--spent' : ''}${targeting?.kind === 'weapon' && !targeting.isOffhand && targeting.actionType === 'bonusAction' && targeting.weapon.id === 'unarmed-strike' ? ' combat-dock-weapon-btn--active' : ''}`}
              title={`${monkBonusStrike.name} (bonus action)`}
              onClick={() => handleMonkBonusClick(monkBonusStrike)}
            >
              <ItemIcon className="combat-dock-weapon-icon" name={monkBonusStrike.name} iconPath={monkBonusStrike.iconPath} />
            </Button>
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
              <Button
                variant="ghost"
                data-action-cost={ability.actionCost}
                className={`combat-dock-ability-btn${(actionsDisabled || !resources[ability.actionCost] || resourceCurrent(character, ability.resourceKey) <= 0) ? ' combat-dock-ability-btn--spent' : ''}${targeting?.kind === 'ability' && targeting.abilityKey === key ? ' combat-dock-ability-btn--active' : ''}`}
                title={ability.label}
                onClick={() => handleAbilityClick(key, ability)}
              >
                <ItemIcon className="combat-dock-weapon-icon" name={ability.label} alt={ability.label} />
              </Button>
              <span className="combat-dock-ability-uses">{resourceCurrent(character, ability.resourceKey)}/{resourceMax(character, ability.resourceKey)}</span>
            </div>
          ))}
          {huntersMark && (
            <div className="combat-dock-ability-group">
              <Button
                variant="ghost"
                data-action-cost={huntersMarkCost}
                className={`combat-dock-ability-btn${(actionsDisabled || !resources[huntersMarkCost!]) ? ' combat-dock-ability-btn--spent' : ''}${targeting?.kind === 'spell' && targeting.spell.name === huntersMark.name ? ' combat-dock-ability-btn--active' : ''}`}
                title={huntersMarkActive ? 'More Favored Enemy' : "Hunter's Mark (Favored Enemy)"}
                onClick={handleCastHuntersMark}
              >
                <ItemIcon className="combat-dock-weapon-icon" name="Hunter's Mark" alt="Hunter's Mark" />
              </Button>
              <span className="combat-dock-ability-uses">{resourceCurrent(character, 'favoredEnemy')}/{resourceMax(character, 'favoredEnemy')}</span>
            </div>
          )}
        </div>
      )}
    <div className="combat-dock">
      <div className="combat-dock-pips">
        {PIPS.map(pip => (
          <PipCounter
            key={pip.key}
            color={pip.key}
            shape="circle"
            max={1}
            current={resources[pip.key] ? 1 : 0}
            active={targeting !== null && pip.key === (targeting.kind === 'ability' ? targeting.actionCost : targeting.actionType)}
            title={pip.title}
          />
        ))}
        <span className="combat-dock-speed">{movementRemaining}ft</span>
        {elevationFt > 0 && (
          <span className="combat-dock-elevation" title="Height off the ground">
            {isFlying && <Button variant="ghost" onClick={() => handleElevationChange(-10)} disabled={elevationFt <= 0}>-</Button>}
            {elevationFt}ft ↑
            {isFlying && <Button variant="ghost" onClick={() => handleElevationChange(10)}>+</Button>}
          </span>
        )}
      </div>

      {ownedResources.length > 0 && (
        <div className="combat-dock-resource-pips">
          {ownedResources.map(def => (
            <PipCounter
              key={def.key}
              color={def.key}
              shape="square"
              max={resourceMax(character, def.key)}
              current={resourceCurrent(character, def.key)}
              active={def.key === activeResourceKey}
              title={def.label}
            />
          ))}
        </div>
      )}

      <div className={`combat-dock-actions${actionsDisabled ? ' combat-dock-actions--disabled' : ''}`}>
        {STANDARD_ACTIONS.map(action => (
          <Button
            key={action.key}
            variant="ghost"
            className={`combat-action-btn combat-action-btn--standard${(actionsDisabled || !resources.action) ? ' combat-action-btn--spent' : ''}`}
            onClick={() => handleStandardAction(action)}
          >
            {action.label}
            <span className="combat-action-btn-cost" />
          </Button>
        ))}
        {isRestrained && (
          <Button
            variant="ghost"
            className={`combat-action-btn combat-action-btn--standard${(actionsDisabled || !resources.action) ? ' combat-action-btn--spent' : ''}`}
            onClick={handleEscapeAttempt}
          >
            Escape
            <span className="combat-action-btn-cost" />
          </Button>
        )}
        {activeBuffs.filter((kind): kind is keyof typeof ACTION_UNLOCKS => kind in ACTION_UNLOCKS).map(kind => {
          const unlock = ACTION_UNLOCKS[kind];
          const disabled = actionsDisabled || (unlock.cost === 'bonusAction' ? !resources.bonusAction : movementRemaining < 10);
          return (
            <Button
              key={kind}
              variant="ghost"
              className={`combat-action-btn combat-action-btn--standard${disabled ? ' combat-action-btn--spent' : ''}`}
              onClick={() => handleActionUnlock(kind)}
            >
              {unlock.label}
              <span className="combat-action-btn-cost" />
            </Button>
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

    <Button
      variant="ghost"
      className={`combat-end-turn-btn${!isMyTurn ? ' combat-end-turn-btn--waiting' : ''}`}
      onKeyDown={e => e.code === 'Space' && e.preventDefault()}
      onClick={() => isMyTurn && dispatch('vtt:combat:turn:end', {})}
    >
      {isMyTurn ? 'End Turn' : 'Waiting…'}
    </Button>

  </div>

  {amountModal && amountModalAbility && createPortal(
    <div className="modal-overlay" onClick={() => setAmountModal(null)}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{amountModalAbility.label}</h2>
        </div>
        <div className="modal-form">
          <label className="modal-label">
            <span className="create-label-row">
              Heal Amount (HP)
              <InfoTooltip text={`Restore this many hit points to the target from your ${amountModalAbility.label} pool (${amountModalPool} remaining).`} />
            </span>
            <input
              className="modal-input"
              type="number"
              min={1}
              max={Math.max(1, amountModalPool)}
              disabled={amountModal.cure}
              value={amountModal.amount}
              onChange={e => {
                const amount = Math.max(1, Math.min(Number(e.target.value) || 1, amountModalPool));
                setAmountModal(prev => prev && { ...prev, amount });
              }}
            />
          </label>
          {amountModalCureCost !== undefined && (
            <label className="feature-checkbox">
              <input
                type="checkbox"
                checked={amountModal.cure}
                disabled={!amountModalCanCure}
                onChange={() => setAmountModal(prev => prev && { ...prev, cure: !prev.cure })}
              />
              <span className="create-label-row">
                Cure Poisoned ({amountModalCureCost} points)
                <InfoTooltip text={`Instead of healing, spend ${amountModalCureCost} points from your ${amountModalAbility.label} pool to remove the Poisoned condition from the target. Requires at least ${amountModalCureCost} points remaining.`} />
              </span>
            </label>
          )}
        </div>
        <div className="modal-actions">
          <Button variant="outline" color="secondary" onClick={() => setAmountModal(null)}>Cancel</Button>
          <Button onClick={confirmAmountModal} disabled={!amountModalCanAccept}>Accept</Button>
        </div>
      </dialog>
    </div>,
    document.body
  )}
  </>
  );
}
