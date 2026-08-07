import { Condition } from './Condition.ts';

/** Bookkeeping only — no roll effect of its own. See ConcentrationLink for what it sustains. */
export class Concentrating extends Condition {
  readonly name = 'Concentrating' as const;
  readonly description = 'Sustaining a spell — ends if incapacitated, killed, or a Constitution save is failed after taking damage.';
}
