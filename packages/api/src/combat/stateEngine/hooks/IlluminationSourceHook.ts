import type { TurnContext } from 'shared';
import { Hook, type HookProps } from '../Hook.ts';

/**
 * Marks its owner as currently emitting light (Light's object, Starry Wisp's Dim Light) — pure
 * bookkeeping like IllusionTagHook, nothing reads `apply()`. Found via
 * engine.getHooksByKind('illuminationSource') by recomputeIllumination (combat/runtime.ts),
 * which takes the max of every active source's `level` against the dungeon's authored
 * baseIllumination — there's no per-cell light-propagation model, only that one global knob, so
 * a lit source brightens the whole dungeon rather than a local radius around its bearer.
 */
export class IlluminationSourceHook extends Hook<'beforeTurn'> {
  readonly stage = 'beforeTurn' as const;
  readonly level: number;

  constructor(props: HookProps & { level: number }) {
    super(props);
    this.level = props.level;
  }

  matches(ctx: TurnContext): boolean {
    return ctx.participantId === this.ownerId;
  }

  apply(): void {}
}
