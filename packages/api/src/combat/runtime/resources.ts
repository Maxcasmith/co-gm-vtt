import type { Character } from 'shared';
import { spellSlotsForCharacter, hasOriginFeat, trySpendResource, resourceCurrent, magicInitiateKeyForSpell, invocationSpell } from 'shared';
import { getCharacter, updateCharacter } from '../../storage.ts';
import { io, campaignRoom, fightOf, playerSocketIds } from '../../state.ts';
import { rollD20, keptDie } from '../dice.ts';
import { offerReaction } from '../stateEngine/reactionPrompt.ts';

/**
 * Origin feat Lucky, offensive half: spends a Luck Point for `char` if they asked for one and
 * have one to spend. The player decides prospectively (before rolling), unlike the defensive
 * half above which has to interrupt the attacker — so this is a plain synchronous spend, not an
 * offer. Returns whether the point was actually spent (drives withAdvantage at the call site).
 */
export async function trySpendLuckForAdvantage(cid: string, characterId: string, char: Character, requested: boolean | undefined): Promise<boolean> {
  if (!requested || !hasOriginFeat(char, 'Lucky') || resourceCurrent(char, 'luckPoints') <= 0) return false;
  const nextResourceUses = trySpendResource(char, 'luckPoints');
  if (!nextResourceUses) return false;
  await updateCharacter(cid, characterId, c => ({ ...c, resourceUses: nextResourceUses }));
  io.to(campaignRoom(cid)).emit('combat:player:featureResources', { characterId, resourceUses: nextResourceUses });
  return true;
}

/**
 * Origin feat Lucky, offensive half, retroactive: the player's own weapon attack just missed —
 * offer a Luck Point spend to reroll the d20, now that the miss is known (replaces the old
 * pre-roll "arm advantage before rolling" HUD toggle). Returns the fresh d20 if spent and
 * accepted, null otherwise — a null means "carry on with the original roll unchanged".
 */
export async function offerLuckAttackReroll(
  cid: string, attackerId: string, attackerName: string, weaponName: string, targetName: string, attackTotal: number, ac: number,
): Promise<number | null> {
  const char = await getCharacter(cid, attackerId);
  if (!char || !hasOriginFeat(char, 'Lucky') || resourceCurrent(char, 'luckPoints') <= 0) return null;

  const picked = await offerReaction(cid, attackerId, [{
    spellName: 'Lucky', kind: 'luckReroll', attackerName, sourceName: weaponName, targetName, attackTotal, currentAc: ac,
  }]);
  if (!picked) return null;

  // Re-check after the await — the point may already be gone (another prompt spent it).
  const fresh = await getCharacter(cid, attackerId);
  if (!fightOf(cid, attackerId) || !fresh) return null;
  const nextResourceUses = trySpendResource(fresh, 'luckPoints');
  if (!nextResourceUses) return null;
  await updateCharacter(cid, attackerId, c => ({ ...c, resourceUses: nextResourceUses }));
  io.to(campaignRoom(cid)).emit('combat:player:featureResources', { characterId: attackerId, resourceUses: nextResourceUses });
  console.log(`[lucky] ${attackerName} spends a Luck Point to reroll a missed attack against ${targetName}`);
  // The new roll is still a D20 Test — a Halfling's Luck rerolls it again if it comes up 1.
  return keptDie(rollD20([], fresh));
}

/**
 * Heroic Inspiration (granted by Musician's performance, or a DM award): spends it for `char` if
 * they asked for one and have one to spend. Mechanically modeled as Advantage on the roll rather
 * than "reroll and take the higher" (RAW) — same output distribution, and it lets this reuse the
 * exact prospective-spend shape trySpendLuckForAdvantage already established.
 */
export async function trySpendHeroicInspiration(cid: string, characterId: string, char: Character, requested: boolean | undefined): Promise<boolean> {
  if (!requested || !char.heroicInspiration) return false;
  await updateCharacter(cid, characterId, c => ({ ...c, heroicInspiration: false }));
  const sid = playerSocketIds.get(characterId);
  if (sid) io.to(sid).emit('character:inspiration:update', { heroicInspiration: false });
  return true;
}

// Only level-1 slots are tracked today (no spells-known growth past level 1 exists yet
// either — see spellSlotsForCharacter). Cantrips (slotLevel 0) and any untracked tier are free.
export async function trySpendSpellSlot(cid: string, charId: string, char: Character, slotLevel: number, spellName: string): Promise<boolean> {
  if (slotLevel !== 1) return true;
  // Armor of Shadows / Pact of the Chain: cast at will, no slot (INVOCATION_SPELLS).
  if (invocationSpell(char, spellName)) return true;

  // Magic Initiate's spell spends its own once-per-Long-Rest charge before any class slot; once
  // that's gone it falls through to slots like any other known spell (2024 PHB). A non-caster
  // (spellSlotsForCharacter 0) has no slots to fall through to, so it's blocked instead.
  const miKey = magicInitiateKeyForSpell(char, spellName);
  const nextResourceUses = miKey ? trySpendResource(char, miKey) : undefined;
  if (nextResourceUses) {
    await updateCharacter(cid, charId, c => ({ ...c, resourceUses: nextResourceUses }));
    io.to(campaignRoom(cid)).emit('combat:player:featureResources', { characterId: charId, resourceUses: nextResourceUses });
    return true;
  }
  if (spellSlotsForCharacter(char) === 0) return false;

  const current = char.currentSpellSlots1 ?? spellSlotsForCharacter(char);
  if (current <= 0) return false;
  const next = current - 1;
  await updateCharacter(cid, charId, c => ({ ...c, currentSpellSlots1: next }));
  io.to(campaignRoom(cid)).emit('combat:player:slots', { characterId: charId, currentSpellSlots1: next, maxSpellSlots1: char.maxSpellSlots1 ?? spellSlotsForCharacter(char) });
  return true;
}

