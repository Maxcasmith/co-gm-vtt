import type { Spell } from 'shared';

export type SpellArea = NonNullable<NonNullable<Spell['combat']>['area']>;

export interface FloatEffect { id: number; gx: number; gy: number; text: string; isHit: boolean; isHeal?: boolean; startTime: number }
export interface FlashEffect { tokenKey: string; startTime: number }
