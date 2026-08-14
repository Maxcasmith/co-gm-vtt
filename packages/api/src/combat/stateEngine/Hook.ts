import type { HookStage, HookContextMap } from 'shared';
import type { StateEngine } from './StateEngine.ts';

export interface HookProps {
  /** Omit to get a generated one. Pass explicitly when something else needs to unregister this hook by id. */
  id?: string;
  ownerId: string;
  /** Display name of whatever created this hook (spell or feature), for logs and prompts. */
  source: string;
  /** Higher runs first. Value modifiers should outrank reaction offers so an offer sees the final numbers. */
  priority?: number;
  /**
   * The HookType this instance was built from — lets code ask "does ownerId have an active
   * X" (StateEngine.hasHookOwnedBy) without importing every concrete Hook subclass to check
   * with instanceof. Only needed by callers that must know an answer *before* a stage fires
   * (advantage/disadvantage has to be decided before the d20 is rolled, too early for the
   * normal trigger() chain) — most hooks never get queried this way and can leave it unset.
   */
  kind?: string;
}

/**
 * One reactive behaviour bound to a single participant and a single lifecycle stage.
 *
 * Subclasses stay small and data-driven — a spell declares a HookSpec and the factory
 * instantiates the matching subclass. Add a new subclass only when no existing one can
 * express the behaviour, the same discipline EffectSpec follows.
 */
export abstract class Hook<S extends HookStage = HookStage> {
  readonly id: string;
  readonly ownerId: string;
  readonly source: string;
  readonly priority: number;
  readonly kind: string | undefined;

  /** The stage this hook fires on. Declared by the subclass, not the caller. */
  abstract readonly stage: S;

  constructor(props: HookProps) {
    this.id = props.id ?? crypto.randomUUID();
    this.ownerId = props.ownerId;
    this.source = props.source;
    this.priority = props.priority ?? 0;
    this.kind = props.kind;
  }

  /** Cheap gate run before apply — return false when this context is not the hook's business. */
  abstract matches(ctx: HookContextMap[S]): boolean;

  /**
   * Mutates the context in place. Per the CONTEXT MUTATION rule in shared/types/combat-hooks.ts,
   * write only the fields documented as mutable; the runtime re-derives the rest afterwards.
   */
  abstract apply(ctx: HookContextMap[S], engine: StateEngine): void | Promise<void>;
}
