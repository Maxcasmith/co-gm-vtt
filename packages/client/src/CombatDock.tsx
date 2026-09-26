import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { BreathShape, Character, Spell, Weapon } from 'shared';
import { actionCostFromCastingTime, isWeapon, hasOriginFeat, unarmedStrikeFor, monkMartialArtsActive, spellSlotsForCharacter, ABILITY_DEFS, RESOURCE_DEFS, resourceCurrent, resourceMax, breathWeaponSpell, ownsAbility } from 'shared';
import { dispatch, on } from './events.ts';
import type { TargetingStartPayload } from './events.ts';
import { Button } from './components/Button/Button.tsx';
import { PipCounter } from './components/PipCounter/PipCounter.tsx';
import ItemIcon from './ItemIcon.tsx';
import InfoTooltip from './create-campaign/InfoTooltip.tsx';
import TileGrid from './character-creation/TileGrid.tsx';
import { PactWeaponModal, startFamiliarAttack } from './characterSheet/PactActions.tsx';
import { FindFamiliarModal } from './characterSheet/FindFamiliarModal.tsx';
import { castBlocked, castSpell, defaultSpellChoices, hasSpellChoices, spellActionCost } from './characterSheet/spellCasting.ts';
import type { CastContext, SpellChoices } from './characterSheet/spellCasting.ts';
import { SpellOptions } from './characterSheet/SpellOptions.tsx';
import './app.css';

const API = `http://${window.location.hostname}:3001`;

interface Props {
  character: Character;
  combatActive: boolean;
  movementRemaining: number;
  playerCurrentHp?: number;
  /** Live level-1 slot pool from the server — same source the character sheet reads. */
  currentSpellSlots1?: number | undefined;
  maxSpellSlots1?: number | undefined;
  /** HUD actions unlocked this turn by an active actionUnlock hook (Expeditious Retreat, Jump) — see ACTION_UNLOCKS below. */
  activeBuffs?: string[];
  /** Height off the ground (Feather Fall, falling damage) — see combat:elevation:set. */
  elevationFt?: number;
  /** Connected players' names, and name→characterId, for the Healer's Kit ally picker. */
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

// Hotbar grids fill column-first, so this order lays out Dash/Dodge on top, Disengage/Hide below.
const STANDARD_ACTIONS = [
  { key: 'dash',      label: 'Dash'      },
  { key: 'disengage', label: 'Disengage', effect: 'Disengaging' },
  { key: 'dodge',     label: 'Dodge',     effect: 'Dodging'     },
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

export default function CombatDock({ character, combatActive, movementRemaining, playerCurrentHp, currentSpellSlots1, maxSpellSlots1, activeBuffs = [], elevationFt = 0, connectedAllies = [], allyCharacterIds = {} }: Props) {
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
  // Dragonborn Breath Weapon's cone-or-line pick, asked before targeting starts.
  const [breathModal, setBreathModal] = useState(false);
  const [pactModal, setPactModal] = useState(false);
  const [inspirationArmed, setInspirationArmed] = useState(false);
  // Origin feat Healer — which ally (or self) to tend with a Healer's Kit charge.
  const [healerPicker, setHealerPicker] = useState(false);
  // Learned spells castable as an action or bonus action — the hotbar's spell zone.
  const [hotbarSpells, setHotbarSpells] = useState<Spell[]>([]);
  // Pre-cast picker for a spell with per-cast options (damage type, Command's word, skill).
  const [spellModal, setSpellModal] = useState<{ spell: Spell; choices: SpellChoices; customCommand: string } | null>(null);
  // Find Familiar asks for a name/description (FindFamiliarModal) before it casts.
  const [familiarSpell, setFamiliarSpell] = useState<Spell | null>(null);
  // Favored Enemy has no ABILITY_DEFS entry — it's spent inside the normal spell-cast flow when
  // casting Hunter's Mark (see combat.ts), so this button fires the same targeting:start
  // SpellsTab uses, from the same spell fetch as the hotbar's spell zone.
  const [huntersMark, setHuntersMark] = useState<Spell | null>(null);
  // Favored Enemy grants Hunter's Mark automatically — "prepared... doesn't count against your
  // prepared spells" (srd.ts) — so it's never in character.spells; gate on the class feature only.
  const favoredEnemyRanger = resourceMax(character, 'favoredEnemy') > 0;
  // Whether THIS character is currently concentrating on their own Hunter's Mark — redirecting an
  // active mark to a new target is a free recast (see combat.ts), so the button reads "More
  // Favored Enemy" rather than implying it'll spend another of the limited uses below.
  const [huntersMarkActive, setHuntersMarkActive] = useState(false);

  const learnedNames = character.spells ?? [];
  useEffect(() => {
    if (!learnedNames.length && !favoredEnemyRanger) { setHotbarSpells([]); setHuntersMark(null); return; }
    // Not class-filtered: feat and lineage spells can come from any class list (see SpellsTab).
    fetch(`${API}/api/spells`)
      .then(r => r.json())
      .then((all: Spell[]) => {
        setHotbarSpells(all
          .filter(s => learnedNames.includes(s.name))
          .filter(s => { const cost = actionCostFromCastingTime(s.castingTime); return cost === 'action' || cost === 'bonusAction'; })
          .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)));
        setHuntersMark(favoredEnemyRanger ? all.find(s => s.name === "Hunter's Mark") ?? null : null);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learnedNames.join(','), favoredEnemyRanger]);

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
      setHealerPicker(false);
      setHuntersMarkActive(false);
      setSpellModal(null);
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

  // Hand slots. An empty main hand (or one holding a non-weapon) falls back to Unarmed Strike
  // for any class; the off-hand slot is hidden unless it holds a weapon — except a Monk with an
  // empty off hand, whose Martial Arts Bonus Unarmed Strike lives there (monkMartialArtsActive
  // carries the full RAW gate: unarmored, shieldless, Monk weapons only).
  const mainHandItem = character.inventory?.find(item => item.id === character.equipment?.mainHand);
  const offHandItem = character.inventory?.find(item => item.id === character.equipment?.offHand);
  const mainWeapon = mainHandItem && isWeapon(mainHandItem) ? mainHandItem : undefined;
  const offWeapon = offHandItem && isWeapon(offHandItem) && offHandItem.id !== mainWeapon?.id ? offHandItem : undefined;
  const mainSlotWeapon = mainWeapon ?? unarmedStrikeFor(character);
  // Two-Weapon Fighting: both hands hold a weapon, neither two-handed — the off-hand weapon
  // attacks as a bonus action. The Two-Weapon Fighting style (added to damage) is checked
  // server-side; every dual-wielder gets the extra attack regardless of style, per RAW.
  const offhandIsTwf = !!(mainWeapon && offWeapon && !mainWeapon.twoHanded && !offWeapon.twoHanded);
  const monkBonusStrike = !offHandItem && monkMartialArtsActive(character) ? unarmedStrikeFor(character) : undefined;

  const availableAbilities = Object.entries(ABILITY_DEFS).filter(([, a]) => ownsAbility(character, a));
  // Every RESOURCE_DEFS pool the character owns (Second Wind, Rage, Favored Enemy, ...) — not
  // just the ones with an ABILITY_DEFS button, so silently-spent pools (Favored Enemy's free
  // Hunter's Mark) get HUD representation too.
  const ownedResources = Object.values(RESOURCE_DEFS).filter(def => resourceMax(character, def.key) > 0);
  const slotsMax = maxSpellSlots1 ?? character.maxSpellSlots1 ?? spellSlotsForCharacter(character);
  const slotsCurrent = currentSpellSlots1 ?? character.currentSpellSlots1 ?? slotsMax;
  const castCtx: CastContext = { character, combatActive, isMyTurn, resources, currentSpellSlots1: slotsCurrent };
  const huntersMarkCost = huntersMark ? (actionCostFromCastingTime(huntersMark.castingTime) ?? 'action') : undefined;
  // Which resource pool the current targeting flow is about to spend — pulses that resource's
  // pips the same way the actionType pip already pulses (see the PIPS.map data-active check).
  const activeResourceKey = targeting?.kind === 'ability'
    ? ABILITY_DEFS[targeting.abilityKey]?.resourceKey
    : targeting?.kind === 'spell' && huntersMark && targeting.spell.name === huntersMark.name ? 'favoredEnemy'
    : targeting?.kind === 'spell' && targeting.spell.name === 'Breath Weapon' ? 'breathWeapon'
    : undefined;

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

  function handleSpellClick(spell: Spell) {
    if (castBlocked(castCtx, spell)) return;
    if (spell.name === 'Find Familiar') {
      setFamiliarSpell(spell);
      return;
    }
    if (hasSpellChoices(spell)) {
      setSpellModal({ spell, choices: defaultSpellChoices(spell), customCommand: '' });
      return;
    }
    castSpell(castCtx, spell, {});
  }

  function confirmSpellModal() {
    if (!spellModal) return;
    const { spell, choices, customCommand } = spellModal;
    setSpellModal(null);
    castSpell(castCtx, spell, { ...choices, command: customCommand.trim() || choices.command });
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

  // Dragonborn Breath Weapon rides the spell-cast flow as a synthetic spell (breathWeaponSpell) —
  // the server rebuilds it from the saved ancestry and spends RESOURCE_DEFS.breathWeapon.
  const hasBreathWeapon = resourceMax(character, 'breathWeapon') > 0;
  const breathBlocked = actionsDisabled || !resources.action || resourceCurrent(character, 'breathWeapon') <= 0;

  function handleBreathShape(shape: BreathShape) {
    setBreathModal(false);
    const spell = breathWeaponSpell(character, shape);
    if (!spell || breathBlocked) return;
    dispatch('vtt:sheet:closed', {});
    dispatch('vtt:targeting:start', { kind: 'spell', spell, casterId: character.id, actionType: 'action', casterLevel: character.level });
  }

  // Warlock pact actions — see characterSheet/PactActions.tsx.
  const hasPactOfTheChain = !!character.invocations?.includes('Pact of the Chain');
  const familiarBlocked = actionsDisabled || !resources.action;
  const familiarTargeting = targeting?.kind === 'weapon' && !!targeting.viaFamiliar;
  const hasPactOfTheBlade = !!character.invocations?.includes('Pact of the Blade');
  const pactBlocked = actionsDisabled || !resources.bonusAction;

  if (isDown) {
    return (
      <div className="combat-dock-wrapper">
        <div className="combat-dock combat-dock--down">
          <span className="combat-dock-down-label">
            {isMyTurn ? 'Making death save…' : 'Unconscious'}
          </span>
        </div>
      </div>
    );
  }

  const actionUsable = !actionsDisabled && resources.action;
  const bonusUsable = !actionsDisabled && resources.bonusAction;

  const amountModalAbility = amountModal ? ABILITY_DEFS[amountModal.key] : undefined;
  const amountModalPool = amountModalAbility ? resourceCurrent(character, amountModalAbility.resourceKey) : 0;
  const amountModalCureCost = amountModalAbility?.cureCost;
  const amountModalCanCure = amountModalCureCost !== undefined && amountModalPool >= amountModalCureCost;
  const amountModalCanAccept = amountModal ? (amountModal.cure ? amountModalCanCure : amountModal.amount >= 1) : false;

  const healersKit = character.inventory?.find(i => i.name === "Healer's Kit" && i.quantity > 0);
  const healerTargets = [
    { name: character.name, id: character.id },
    ...connectedAllies.filter(name => name !== character.name && allyCharacterIds[name]).map(name => ({ name, id: allyCharacterIds[name]! })),
  ];
  const canUseHealerKit = hasOriginFeat(character, 'Healer') && !!healersKit && actionUsable;

  const btnClass = (spent: boolean, active = false) =>
    `combat-dock-weapon-btn${spent ? ' combat-dock-weapon-btn--spent' : ''}${active ? ' combat-dock-weapon-btn--active' : ''}`;
  const targetingWeapon = targeting?.kind === 'weapon' ? targeting : undefined;
  const hasClassSection = availableAbilities.length > 0 || !!huntersMark || hasBreathWeapon || hasPactOfTheChain || hasPactOfTheBlade;

  return (
  <>
  <div className="combat-dock-wrapper">
    <div className="combat-dock">
      {canUseHealerKit && healerPicker && (
        <div className="combat-dock-alert-picker">
          {healerTargets.map(t => (
            <Button key={t.id} variant="ghost" className="combat-dock-luck-toggle" onClick={() => handleHealerKit(t.id)}>
              Tend {t.name === character.name ? 'self' : t.name}
            </Button>
          ))}
          <Button variant="ghost" className="combat-dock-luck-toggle" onClick={() => setHealerPicker(false)}>Cancel</Button>
        </div>
      )}

      <div className="combat-dock-pips">
        <span className="combat-dock-speed" title="Movement remaining">{movementRemaining}ft</span>
        {elevationFt > 0 && (
          <span className="combat-dock-elevation" title="Height off the ground">
            {isFlying && <Button variant="ghost" onClick={() => handleElevationChange(-10)} disabled={elevationFt <= 0}>-</Button>}
            {elevationFt}ft ↑
            {isFlying && <Button variant="ghost" onClick={() => handleElevationChange(10)}>+</Button>}
          </span>
        )}
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
        {slotsMax > 0 && (
          <PipCounter
            color="spellSlot1"
            shape="square"
            max={slotsMax}
            current={slotsCurrent}
            active={targeting?.kind === 'spell' && targeting.spell.level >= 1}
            title="Level 1 Spell Slots"
          />
        )}
      </div>

      {activeEffects.length > 0 && (
        <div className="combat-effects-row">
          {activeEffects.map(effect => (
            <span key={effect} className="combat-effect-badge">{effect}</span>
          ))}
        </div>
      )}

      <div className="combat-hotbar">
        <div className="combat-hotbar-section combat-hotbar-grid">
          <Button
            variant="ghost"
            data-action-cost="action"
            className={btnClass(!actionUsable, targetingWeapon?.actionType === 'action' && targetingWeapon.weapon.id === mainSlotWeapon.id)}
            title={mainSlotWeapon.name}
            onClick={() => handleWeaponClick(mainSlotWeapon)}
          >
            <ItemIcon className="combat-dock-weapon-icon" name={mainSlotWeapon.name} iconPath={mainSlotWeapon.iconPath} alt={mainSlotWeapon.name} />
          </Button>
          {offWeapon && (offhandIsTwf ? (
            <Button
              variant="ghost"
              data-action-cost="bonusAction"
              className={btnClass(!bonusUsable, !!targetingWeapon?.isOffhand)}
              title={`${offWeapon.name} (off-hand)`}
              onClick={() => handleOffhandClick(offWeapon)}
            >
              <ItemIcon className="combat-dock-weapon-icon" name={offWeapon.name} iconPath={offWeapon.iconPath} alt={offWeapon.name} />
            </Button>
          ) : (
            <Button
              variant="ghost"
              data-action-cost="action"
              className={btnClass(!actionUsable, targetingWeapon?.actionType === 'action' && targetingWeapon.weapon.id === offWeapon.id)}
              title={offWeapon.name}
              onClick={() => handleWeaponClick(offWeapon)}
            >
              <ItemIcon className="combat-dock-weapon-icon" name={offWeapon.name} iconPath={offWeapon.iconPath} alt={offWeapon.name} />
            </Button>
          ))}
          {monkBonusStrike && (
            <Button
              variant="ghost"
              data-action-cost="bonusAction"
              className={btnClass(!bonusUsable, targetingWeapon?.actionType === 'bonusAction' && !targetingWeapon.isOffhand && targetingWeapon.weapon.id === monkBonusStrike.id)}
              title={`${monkBonusStrike.name} (bonus action)`}
              onClick={() => handleMonkBonusClick(monkBonusStrike)}
            >
              <ItemIcon className="combat-dock-weapon-icon" name={monkBonusStrike.name} iconPath={monkBonusStrike.iconPath} alt={monkBonusStrike.name} />
            </Button>
          )}
        </div>

        <div className="combat-hotbar-section combat-hotbar-grid">
          {STANDARD_ACTIONS.map(action => (
            <Button
              key={action.key}
              variant="ghost"
              data-action-cost="action"
              className={btnClass(!actionUsable)}
              title={action.label}
              onClick={() => handleStandardAction(action)}
            >
              <ItemIcon className="combat-dock-weapon-icon" name={action.label} alt={action.label} />
            </Button>
          ))}
          {isRestrained && (
            <Button variant="ghost" data-action-cost="action" className={btnClass(!actionUsable)} title="Escape" onClick={handleEscapeAttempt}>
              <ItemIcon className="combat-dock-weapon-icon" name="Escape" alt="Escape" />
            </Button>
          )}
          {activeBuffs.filter((kind): kind is keyof typeof ACTION_UNLOCKS => kind in ACTION_UNLOCKS).map(kind => {
            const unlock = ACTION_UNLOCKS[kind];
            const disabled = actionsDisabled || (unlock.cost === 'bonusAction' ? !resources.bonusAction : movementRemaining < 10);
            return (
              <Button
                key={kind}
                variant="ghost"
                data-action-cost={unlock.cost === 'bonusAction' ? 'bonusAction' : undefined}
                className={btnClass(disabled)}
                title={unlock.label}
                onClick={() => handleActionUnlock(kind)}
              >
                <ItemIcon className="combat-dock-weapon-icon" name={unlock.label} alt={unlock.label} />
              </Button>
            );
          })}
          {canUseHealerKit && (
            <Button
              variant="ghost"
              data-action-cost="action"
              className={btnClass(false, healerPicker)}
              title={`Healer's Kit (${healersKit?.quantity}) — expend a use to tend a creature within 5ft`}
              onClick={() => setHealerPicker(prev => !prev)}
            >
              <ItemIcon className="combat-dock-weapon-icon" name="Healer's Kit" alt="Healer's Kit" />
            </Button>
          )}
          {character.heroicInspiration && (
            <Button
              variant="ghost"
              className={btnClass(false, inspirationArmed)}
              title={`Heroic Inspiration${inspirationArmed ? ' (armed)' : ''} — spend on your next attack roll for Advantage`}
              onClick={() => setInspirationArmed(prev => !prev)}
            >
              <ItemIcon className="combat-dock-weapon-icon" name="Heroic Inspiration" alt="Heroic Inspiration" />
            </Button>
          )}
        </div>

        {hasClassSection && (
          <div className="combat-hotbar-section">
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
            {hasBreathWeapon && (
              <div className="combat-dock-ability-group">
                <Button
                  variant="ghost"
                  data-action-cost="action"
                  className={`combat-dock-ability-btn${breathBlocked ? ' combat-dock-ability-btn--spent' : ''}${targeting?.kind === 'spell' && targeting.spell.name === 'Breath Weapon' ? ' combat-dock-ability-btn--active' : ''}`}
                  title="Breath Weapon"
                  onClick={() => !breathBlocked && setBreathModal(true)}
                >
                  <ItemIcon className="combat-dock-weapon-icon" name="Breath Weapon" alt="Breath Weapon" />
                </Button>
                <span className="combat-dock-ability-uses">{resourceCurrent(character, 'breathWeapon')}/{resourceMax(character, 'breathWeapon')}</span>
              </div>
            )}
            {hasPactOfTheBlade && (
              <div className="combat-dock-ability-group">
                <Button
                  variant="ghost"
                  data-action-cost="bonusAction"
                  className={`combat-dock-ability-btn${pactBlocked ? ' combat-dock-ability-btn--spent' : ''}`}
                  title="Pact Weapon (Pact of the Blade)"
                  onClick={() => !pactBlocked && setPactModal(true)}
                >
                  <ItemIcon className="combat-dock-weapon-icon" name="Pact Weapon" alt="Pact Weapon" />
                </Button>
              </div>
            )}
            {hasPactOfTheChain && (
              <div className="combat-dock-ability-group">
                <Button
                  variant="ghost"
                  data-action-cost="action"
                  className={`combat-dock-ability-btn${familiarBlocked ? ' combat-dock-ability-btn--spent' : ''}${familiarTargeting ? ' combat-dock-ability-btn--active' : ''}`}
                  title="Familiar Attack (Pact of the Chain)"
                  onClick={() => !familiarBlocked && startFamiliarAttack(character)}
                >
                  <ItemIcon className="combat-dock-weapon-icon" name="Familiar Attack" alt="Familiar Attack" />
                </Button>
              </div>
            )}
          </div>
        )}

        {hotbarSpells.length > 0 && (
          <div className="combat-hotbar-section combat-hotbar-grid combat-hotbar-spells">
            {hotbarSpells.map(spell => (
              <Button
                key={spell.name}
                variant="ghost"
                data-action-cost={spellActionCost(spell)}
                className={btnClass(castBlocked(castCtx, spell), targeting?.kind === 'spell' && targeting.spell.name === spell.name)}
                title={`${spell.name} (${spell.levelLabel})`}
                onClick={() => handleSpellClick(spell)}
              >
                <ItemIcon className="combat-dock-weapon-icon" name={spell.name} alt={spell.name} />
              </Button>
            ))}
          </div>
        )}

        <Button
          variant="ghost"
          className={`combat-end-turn-btn${!isMyTurn ? ' combat-end-turn-btn--waiting' : ''}`}
          onKeyDown={e => e.code === 'Space' && e.preventDefault()}
          onClick={() => isMyTurn && dispatch('vtt:combat:turn:end', {})}
        >
          {isMyTurn ? 'End Turn' : 'Waiting…'}
        </Button>
      </div>
    </div>
  </div>

  {spellModal && createPortal(
    <div className="modal-overlay" onClick={() => setSpellModal(null)}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{spellModal.spell.name}</h2>
        </div>
        <div className="modal-form">
          <SpellOptions
            spell={spellModal.spell}
            choices={spellModal.choices}
            customCommand={spellModal.customCommand}
            onChange={choices => setSpellModal(prev => prev && { ...prev, choices })}
            onCustomCommandChange={customCommand => setSpellModal(prev => prev && { ...prev, customCommand })}
          />
        </div>
        <div className="modal-actions">
          <Button variant="outline" color="secondary" onClick={() => setSpellModal(null)}>Cancel</Button>
          <Button onClick={confirmSpellModal}>Cast</Button>
        </div>
      </dialog>
    </div>,
    document.body
  )}

  {breathModal && createPortal(
    <div className="modal-overlay" onClick={() => setBreathModal(false)}>
      <dialog className="modal campaign-modal" open onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Breath Weapon</h2>
        </div>
        <div className="modal-form">
          <TileGrid
            items={[{ id: 'cone', name: 'Cone (15ft)' }, { id: 'line', name: 'Line (30ft)' }]}
            selectedId=""
            onSelect={id => handleBreathShape(id === 'line' ? 'line' : 'cone')}
          />
        </div>
        <div className="modal-actions">
          <Button variant="outline" color="secondary" onClick={() => setBreathModal(false)}>Cancel</Button>
        </div>
      </dialog>
    </div>,
    document.body
  )}

  {familiarSpell && (
    <FindFamiliarModal
      character={character}
      onClose={() => setFamiliarSpell(null)}
      onSummon={familiar => {
        setFamiliarSpell(null);
        castSpell(castCtx, familiarSpell, { familiar });
      }}
    />
  )}

  {pactModal && <PactWeaponModal character={character} onClose={() => setPactModal(false)} />}

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
