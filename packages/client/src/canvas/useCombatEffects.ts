import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Player } from 'shared';
import { on } from '../events.ts';
import { FLOAT_DUR, FLASH_DUR, IMPACT_DUR, SWING_DUR } from './constants.ts';
import type { FloatEffect, FlashEffect, TokenSpecialEffect, SwingEffect } from './types.ts';

/**
 * Every transient combat visual (damage/heal/miss/save floats, hit flashes, aura/impact badges,
 * weapon-swing streaks) plus concentration tracking — all driven by socket events, all read back
 * by Canvas.tsx's draw loop. Grouped here because they're one self-contained subsystem: an
 * animation-frame loop (kickAnimLoop) that prunes expired entries and forces a redraw (animTick)
 * only while something is actually animating.
 */
export function useCombatEffects(
  tokenPositionsRef: RefObject<Record<string, { gx: number; gy: number }> | undefined>,
  connectedRef: RefObject<Player[]>,
) {
  const floatEffectsRef = useRef<FloatEffect[]>([]);
  const flashEffectsRef = useRef<FlashEffect[]>([]);
  // Per-token special effects: 'aura' persists until explicitly cleared (combat:effect:aura:end),
  // 'impact' expires after IMPACT_DUR like the other timed effects below.
  const tokenEffectsRef = useRef<TokenSpecialEffect[]>([]);
  // Weapon attack swing effects (attacker → target) — expire after SWING_DUR.
  const swingEffectsRef = useRef<SwingEffect[]>([]);
  // Who's concentrating on what, keyed by both id and name since tokens are looked up either
  // way depending on kind (enemies/companions by id, players by name — see Canvas.tsx's draw loop).
  const [concentrating, setConcentrating] = useState<Record<string, string>>({});
  const [animTick, setAnimTick] = useState(0);
  const animRafRef = useRef<number | null>(null);

  function kickAnimLoop() {
    if (animRafRef.current !== null) return;
    function tick() {
      const now = Date.now();
      floatEffectsRef.current = floatEffectsRef.current.filter(e => now - e.startTime < FLOAT_DUR);
      flashEffectsRef.current = flashEffectsRef.current.filter(e => now - e.startTime < FLASH_DUR);
      tokenEffectsRef.current = tokenEffectsRef.current.filter(e => e.kind === 'aura' || now - e.startTime < IMPACT_DUR);
      swingEffectsRef.current = swingEffectsRef.current.filter(e => now - e.startTime < SWING_DUR);
      setAnimTick(t => t + 1);
      if (floatEffectsRef.current.length > 0 || flashEffectsRef.current.length > 0 || tokenEffectsRef.current.length > 0 || swingEffectsRef.current.length > 0) {
        animRafRef.current = requestAnimationFrame(tick);
      } else {
        animRafRef.current = null;
      }
    }
    animRafRef.current = requestAnimationFrame(tick);
  }

  function resolveTokenPos(id: string, name: string): { pos: { gx: number; gy: number }; tokenKey: string } | null {
    const posById   = tokenPositionsRef.current?.[id];
    const posByName = tokenPositionsRef.current?.[name];
    const pos       = posById ?? posByName;
    if (!pos) return null;
    return { pos, tokenKey: posById ? id : name };
  }

  // The one place damage gets drawn — flash + floating number. Every damage source (weapon hit,
  // spell hit, spell-save damage) routes through this instead of each pushing its own float.
  function pushDamageFloat(targetId: string, targetName: string, damage: number) {
    const resolved = resolveTokenPos(targetId, targetName);
    if (!resolved) return;
    const now = Date.now();
    flashEffectsRef.current.push({ tokenKey: resolved.tokenKey, startTime: now });
    floatEffectsRef.current.push({ id: now, gx: resolved.pos.gx, gy: resolved.pos.gy, text: `-${damage}`, isHit: true, startTime: now });
    kickAnimLoop();
  }

  function pushMissFloat(targetId: string, targetName: string) {
    const resolved = resolveTokenPos(targetId, targetName);
    if (!resolved) return;
    const now = Date.now();
    floatEffectsRef.current.push({ id: now, gx: resolved.pos.gx, gy: resolved.pos.gy, text: 'Miss', isHit: false, startTime: now });
    kickAnimLoop();
  }

  // Saving throws aren't attack rolls — no "Miss". A failed save with no damage (e.g. Tasha's
  // Caustic Brew: no on-cast damage, just a lingering effect) still reads as a failure.
  function pushSaveOutcomeFloat(targetId: string, targetName: string, saved: boolean) {
    const resolved = resolveTokenPos(targetId, targetName);
    if (!resolved) return;
    const now = Date.now();
    floatEffectsRef.current.push({ id: now, gx: resolved.pos.gx, gy: resolved.pos.gy, text: saved ? 'Saved' : 'Failed', isHit: false, startTime: now });
    kickAnimLoop();
  }

  function pushHealFloat(characterId: string, characterName: string, healAmount: number) {
    const resolved = resolveTokenPos(characterId, characterName);
    if (!resolved) return;
    const now = Date.now();
    floatEffectsRef.current.push({ id: now, gx: resolved.pos.gx, gy: resolved.pos.gy, text: `+${healAmount}`, isHit: false, isHeal: true, startTime: now });
    kickAnimLoop();
  }

  useEffect(() => on('vtt:consumable:heal:result', result => {
    pushHealFloat(result.characterId, result.characterName, result.healAmount);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The one place damage floats come from — fired by applyDamageToPlayer/applyDamageToCreature
  // server-side, so every damage source (weapon hit, spell hit, spell-save damage, recurring
  // ticks) draws the same way without each attack-result handler needing its own float call.
  useEffect(() => on('vtt:combat:damage:dealt', result => {
    pushDamageFloat(result.targetId, result.targetName, result.damage);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:attack:result', result => {
    if (!result.hit) pushMissFloat(result.targetId, result.targetName);
    // Swing effect plays on the swing itself, hit or miss — enemy attacks are excluded, only
    // players (this one or an ally) get a visible slash/streak today.
    if (connectedRef.current.includes(result.attackerName)) {
      const from = resolveTokenPos(result.attackerName, result.attackerName);
      const to = resolveTokenPos(result.targetId, result.targetName);
      if (from && to) {
        const dt = result.damageType?.toLowerCase();
        const kind: SwingEffect['kind'] = dt === 'slashing' || dt === 'bludgeoning' || dt === 'piercing' ? dt : (result.isMelee ? 'slashing' : 'piercing');
        swingEffectsRef.current.push({ kind, fromKey: from.tokenKey, toKey: to.tokenKey, startTime: Date.now() });
        kickAnimLoop();
      }
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:spell:attack:result', result => {
    if (!result.hit) pushMissFloat(result.targetId, result.targetName);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:spell:save:result', result => {
    for (const outcome of result.outcomes) {
      if (outcome.damage == null) pushSaveOutcomeFloat(outcome.targetId, outcome.targetName, outcome.saved);
    }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:effect:aura:start', data => {
    const resolved = resolveTokenPos(data.casterId, data.casterName);
    if (!resolved) return;
    tokenEffectsRef.current = tokenEffectsRef.current.filter(e => !(e.kind === 'aura' && e.tokenKey === resolved.tokenKey));
    tokenEffectsRef.current.push({ kind: 'aura', tokenKey: resolved.tokenKey, color: data.color, style: data.style, startTime: Date.now() });
    kickAnimLoop();
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:effect:aura:end', data => {
    const resolved = resolveTokenPos(data.casterId, data.casterName);
    const key = resolved?.tokenKey ?? data.casterName;
    tokenEffectsRef.current = tokenEffectsRef.current.filter(e => !(e.kind === 'aura' && e.tokenKey === key));
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:effect:impact', data => {
    const resolved = resolveTokenPos(data.targetId, data.targetName);
    if (!resolved) return;
    tokenEffectsRef.current.push({ kind: 'impact', tokenKey: resolved.tokenKey, color: data.color, style: data.style, startTime: Date.now() });
    kickAnimLoop();
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:concentration', ({ targetId, targetName, spellName }) => {
    setConcentrating(prev => {
      const next = { ...prev };
      if (spellName === null) { delete next[targetId]; delete next[targetName]; }
      else { next[targetId] = spellName; next[targetName] = spellName; }
      return next;
    });
  }), []);
  useEffect(() => on('vtt:combat:state', ({ active }) => { if (!active) setConcentrating({}); }), []);

  return { floatEffectsRef, flashEffectsRef, tokenEffectsRef, swingEffectsRef, concentrating, animTick };
}
