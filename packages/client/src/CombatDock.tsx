import { useState, useEffect } from 'react';
import type { Character, Weapon } from 'shared';
import { dispatch, on } from './events.ts';
import './app.css';

interface Props {
  character: Character;
  combatActive: boolean;
  movementRemaining: number;
  playerCurrentHp?: number;
}

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

export default function CombatDock({ character, combatActive, movementRemaining, playerCurrentHp }: Props) {
  const [resources, setResources] = useState<Resources>(() =>
    combatActive ? loadResources(character.id) : ALL_AVAILABLE
  );
  const [targeting, setTargeting] = useState<Weapon | null>(null);
  const [activeEffects, setActiveEffects] = useState<string[]>([]);
  const [isMyTurn, setIsMyTurn] = useState(false);

  // When combat ends, clear storage and reset
  useEffect(() => {
    if (!combatActive) {
      sessionStorage.removeItem(storageKey(character.id));
      setTargeting(null);
      setIsMyTurn(false);
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
    spendAction();
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

  useEffect(() => on('vtt:targeting:start', ({ weapon }) => setTargeting(weapon)), []);
  useEffect(() => on('vtt:targeting:cancel', () => setTargeting(null)), []);

  if (!combatActive) return null;

  const isDown = (playerCurrentHp ?? Infinity) <= 0;
  const baseSpeed = character.speed ?? 30;
  const actionsDisabled = !isMyTurn || isDown;

  function spendAction() {
    setResources(prev => {
      const next = { ...prev, action: false };
      saveResources(character.id, next);
      return next;
    });
    dispatch('vtt:combat:action:spent', {});
  }

  function handleStandardAction(action: typeof STANDARD_ACTIONS[number]) {
    if (actionsDisabled || !resources.action) return;
    spendAction();
    if (action.key === 'dash') {
      dispatch('vtt:movement:gained', { ft: baseSpeed });
    } else if ('effect' in action && action.effect) {
      setActiveEffects(prev => prev.includes(action.effect) ? prev : [...prev, action.effect]);
    }
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

  return (
  <div className="combat-dock-wrapper">
    <div className="combat-dock">
      <div className="combat-dock-pips">
        {PIPS.map(pip => (
          <div
            key={pip.key}
            data-resource={pip.key}
            data-active={targeting !== null && pip.key === 'action' ? 'true' : undefined}
            className={`combat-pip${!resources[pip.key] ? ' combat-pip--spent' : ''}`}
            title={pip.title}
          />
        ))}
        <span className="combat-dock-speed">{movementRemaining}ft</span>
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
      </div>

      {activeEffects.length > 0 && (
        <div className="combat-effects-row">
          {activeEffects.map(effect => (
            <span key={effect} className="combat-effect-badge">{effect}</span>
          ))}
        </div>
      )}
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
