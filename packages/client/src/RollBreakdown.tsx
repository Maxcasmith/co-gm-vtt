import type { ReactNode } from 'react';
import type { RollBreakdown } from 'shared';

export function fmtBonus(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

const MODE_LABEL: Record<RollBreakdown['mode'], string> = {
  normal: 'Roll',
  advantage: 'Advantage Roll',
  disadvantage: 'Disadvantage Roll',
};

/** Why the roll had (or cancelled) Advantage/Disadvantage, and whether a reroll replaced it — null for a plain roll. */
function modeNote(b: RollBreakdown): string | null {
  const advantage = b.modeSources.filter(s => s.sign > 0).map(s => s.label);
  const disadvantage = b.modeSources.filter(s => s.sign < 0).map(s => s.label);
  const parts = [
    advantage.length ? `Advantage: ${advantage.join(', ')}` : '',
    disadvantage.length ? `Disadvantage: ${disadvantage.join(', ')}` : '',
    b.mode === 'normal' && advantage.length && disadvantage.length ? 'cancelled' : '',
    b.rerolledFrom !== undefined ? `rerolled${b.rerolledBy ? ` (${b.rerolledBy})` : ''}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Every d20 rolled — any discarded die (the dropped Advantage/Disadvantage die, or one a reroll replaced) smaller and greyed, left of the kept one. */
function RollDice({ breakdown }: { breakdown: RollBreakdown }) {
  const discarded = [
    ...(breakdown.rerolledFrom !== undefined ? [breakdown.rerolledFrom] : []),
    ...breakdown.dice.filter((_, i) => i !== breakdown.keptIndex),
  ];
  return (
    <span className="roll-dice">
      {discarded.map((d, i) => <span key={i} className="roll-die roll-die--discarded">{d}</span>)}
      <span className="roll-die">{breakdown.dice[breakdown.keptIndex]}</span>
    </span>
  );
}

/** The dice line plus one line per modifier — every number that summed into the total. */
export function RollRows({ breakdown }: { breakdown: RollBreakdown }) {
  const note = modeNote(breakdown);
  return (
    <>
      <span className="roll-row">
        <span className="roll-row-label">
          {MODE_LABEL[breakdown.mode]} (d20)
          {note && <span className="roll-note">{note}</span>}
        </span>
        <RollDice breakdown={breakdown} />
      </span>
      {breakdown.modifiers.map((m, i) => (
        <span key={i} className="roll-row">
          <span className="roll-row-label">{m.label}</span>
          <span className="roll-mod">{fmtBonus(m.value)}</span>
        </span>
      ))}
    </>
  );
}

/** Hover/focus target showing a roll's full breakdown — the Adventure Log line, a turn-order initiative. */
export function RollTooltip({ breakdown, placement = 'above', children }: {
  breakdown: RollBreakdown;
  placement?: 'above' | 'below';
  children: ReactNode;
}) {
  return (
    <span className={`roll-tooltip roll-tooltip--${placement}`} tabIndex={0}>
      {children}
      <span className="roll-tooltip-panel" role="tooltip">
        <RollRows breakdown={breakdown} />
        <span className="roll-row roll-row--total">
          <span className="roll-row-label">Total</span>
          <span className="roll-mod">{breakdown.total}</span>
        </span>
      </span>
    </span>
  );
}
