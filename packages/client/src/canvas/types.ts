import type { Spell, SenseKind } from 'shared';

export type SpellArea = NonNullable<NonNullable<Spell['combat']>['area']>;

/** Per-sense-kind cell coverage for the local player's own token — one Set per granted sense, "gx,gy" keyed. Built by useVision, consumed by lighting.ts's per-cell/per-token policy. */
export type SenseCells = Partial<Record<SenseKind, Set<string>>>;

/**
 * How a token should be visually dimmed — structured data instead of a CSS `filter` string. Both
 * `ctx.filter` and `ctx.shadowBlur` are known to knock a 2D canvas off its GPU-accelerated path in
 * Chromium (the whole context, not just the filtered call), so drawToken() applies these itself
 * via clip + globalCompositeOperation('saturation')/globalAlpha instead of ever setting ctx.filter.
 * `grayscale` and `brightness` are mutually exclusive in practice (see tokenLightFilter) but both
 * fields exist so a caller could combine them with `opacity` (dead/down) if that ever changes.
 */
export interface TokenDim {
  grayscale?: boolean;
  /** 0..1, same meaning as CSS brightness()'s fraction — 1 = no change. */
  brightness?: number;
  /** 0..1 alpha applied to the whole token (sprite + ring), same meaning as CSS opacity(). */
  opacity?: number;
}

export interface FloatEffect { id: number; gx: number; gy: number; text: string; isHit: boolean; isHeal?: boolean; startTime: number }
export interface FlashEffect { tokenKey: string; startTime: number }

/**
 * A single-token visual effect (aura or impact). 'aura' loops indefinitely — armed on a token
 * (Searing/Thunderous Smite waiting for its weapon hit) and cleared explicitly by
 * 'vtt:combat:effect:aura:end', never by elapsed time. 'impact' is a one-shot burst that expires
 * after IMPACT_DUR.
 */
export type TokenSpecialEffect =
  | { kind: 'aura'; tokenKey: string; color: string; style?: 'fire' | undefined; startTime: number }
  | { kind: 'impact'; tokenKey: string; color: string; style?: 'fire' | undefined; startTime: number };

/** A one-shot two-endpoint effect for a weapon attack's swing — expires after SWING_DUR. Kind is the weapon's damage type, not its range. */
export interface SwingEffect { kind: 'slashing' | 'bludgeoning' | 'piercing'; fromKey: string; toKey: string; startTime: number }
