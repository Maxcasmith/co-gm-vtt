import type { HookStage, HookContextMap } from 'shared';
import { logError } from '../../logger.ts';
import type { Hook } from './Hook.ts';

// Every context type uses a different subset of these — picking opportunistically instead of
// switching per stage keeps this one line instead of sixteen. Order matters: it's roughly
// "who/what" before "the numbers", so the log reads left-to-right like a sentence.
const SUMMARY_KEYS = [
  'participantName', 'attackerName', 'targetName', 'casterName', 'spellName', 'sourceName',
  'd20', 'attackBonus', 'saveBonus', 'total', 'ac', 'dc', 'hit', 'saved',
  'amount', 'damageType', 'isPlayer', 'round', 'slotLevel',
] as const;

function describeContext(ctx: object): string {
  const parts: string[] = [];
  for (const key of SUMMARY_KEYS) {
    if (!(key in ctx)) continue;
    const value = (ctx as Record<string, unknown>)[key];
    if (value === undefined) continue;
    parts.push(`${key}=${value}`);
  }
  return parts.join(' ');
}

/**
 * Per-campaign registry of live combat hooks, fired stage by stage as combat resolves.
 *
 * Deliberately not persisted: Encounter.toJSON() only serializes enemy stat blocks, so turn
 * order, rounds and participants already do not survive a restart. Persisting hooks would
 * exceed that fidelity for no gain — revisit together with the rest of encounter state if
 * mid-combat reload ever becomes a real requirement.
 */
export class StateEngine {
  readonly campaignId: string;
  private hooks = new Map<HookStage, Hook[]>();

  constructor(campaignId: string) {
    this.campaignId = campaignId;
  }

  register(hook: Hook): void {
    // Ids are deterministic for hooks that may be registered from more than one path (reaction
    // offers), so re-registering is a no-op rather than a duplicate that fires twice.
    if (this.has(hook.id)) return;
    const list = this.hooks.get(hook.stage) ?? [];
    list.push(hook);
    // Highest priority first, so value modifiers land before the reaction offers that read them.
    list.sort((a, b) => b.priority - a.priority);
    this.hooks.set(hook.stage, list);
    console.log(`[hook] register ${hook.source} (${hook.stage}) for ${hook.ownerId}`);
  }

  unregister(id: string): void {
    for (const [stage, list] of this.hooks) {
      const idx = list.findIndex(h => h.id === id);
      if (idx === -1) continue;
      console.log(`[hook] unregister ${list[idx]!.source} (${stage})`);
      list.splice(idx, 1);
      return;
    }
  }

  /** Drops every hook belonging to a participant — used when they leave the fight. */
  unregisterByOwner(ownerId: string): void {
    for (const list of this.hooks.values()) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]!.ownerId === ownerId) list.splice(i, 1);
      }
    }
  }

  /** Drops a participant's hooks from one source, so recasting a spell replaces rather than stacks it. */
  unregisterBySource(ownerId: string, source: string): void {
    for (const list of this.hooks.values()) {
      for (let i = list.length - 1; i >= 0; i--) {
        const h = list[i]!;
        if (h.ownerId === ownerId && h.source === source) list.splice(i, 1);
      }
    }
  }

  has(id: string): boolean {
    for (const list of this.hooks.values()) {
      if (list.some(h => h.id === id)) return true;
    }
    return false;
  }

  /**
   * True if ownerId currently has a hook of the given kind registered, on any stage. For
   * questions that must be answered *before* a stage fires — advantage/disadvantage (Faerie
   * Fire, Guiding Bolt) has to be decided before the d20 is rolled, which is earlier than
   * beforeAttackRoll's trigger() chain ever runs.
   */
  hasHookOwnedBy(ownerId: string, kind: string): boolean {
    for (const list of this.hooks.values()) {
      if (list.some(h => h.ownerId === ownerId && h.kind === kind)) return true;
    }
    return false;
  }

  /** Same pre-roll use case as hasHookOwnedBy, but for callers that need the hooks' own data (creatureTypes gate, a stored DC) rather than a yes/no. */
  getHooksOwnedBy(ownerId: string, kind: string): Hook[] {
    const result: Hook[] = [];
    for (const list of this.hooks.values()) {
      for (const h of list) if (h.ownerId === ownerId && h.kind === kind) result.push(h);
    }
    return result;
  }

  /** Same as getHooksOwnedBy but across every owner — sweepGameTimeExpiries needs every gameTimeExpiry hook in the fight, not just one participant's. */
  getHooksByKind(kind: string): Hook[] {
    const result: Hook[] = [];
    for (const list of this.hooks.values()) {
      for (const h of list) if (h.kind === kind) result.push(h);
    }
    return result;
  }

  /**
   * Runs every matching hook for a stage, in priority order, and returns the (mutated) context.
   *
   * Hooks may register or unregister other hooks while running — accepting Shield registers its
   * AC modifier and expiry mid-chain — so the list is snapshotted first and each entry re-checked
   * for membership before it fires. A hook that throws is logged and skipped rather than allowed
   * to abort the chain, which would strand the turn loop mid-resolution.
   *
   * Logs once per call regardless of how many hooks fired — including zero — so every stage is
   * provably reached in the combat log, not just the ones with something registered on them.
   */
  async trigger<S extends HookStage>(stage: S, ctx: HookContextMap[S]): Promise<HookContextMap[S]> {
    const snapshot = [...(this.hooks.get(stage) ?? [])] as Hook<S>[];
    let fired = 0;
    for (const hook of snapshot) {
      if (!this.has(hook.id)) continue;
      try {
        if (!hook.matches(ctx)) continue;
        await hook.apply(ctx, this);
        fired++;
      } catch (err) {
        logError(`stateEngine:${stage}:${hook.source}`, err);
      }
    }
    console.log(`[hook] ${stage} (${fired}/${snapshot.length} fired) ${describeContext(ctx)}`);
    return ctx;
  }
}
