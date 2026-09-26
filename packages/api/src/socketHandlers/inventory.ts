import { isWeapon, isArmor, effectiveWeaponProfs, effectiveArmorTraining, characterLightRangeFt, isPactWeapon } from 'shared';
import type { Manoeuvre } from 'shared';
import { getCharacter, updateCharacter } from '../storage.ts';
import { io, campaignRoom, playerSocketIds, fightOf } from '../state.ts';
import { rollDice, calcMaxHp } from '../combat/dice.ts';
import { setLightSourceFor } from '../combat/runtime/environment.ts';
import { resolveLockpickAttempt, resolveTrapDisarmAttempt } from '../dungeon/runtime.ts';
import type { JoinContext } from './context.ts';

// Mirrors InventoryTab's click-handler name match (client has no structured heal data to read —
// Consumable.effect is free text) — kept in sync manually since there's no shared item-effects table.
const POTION_OF_HEALING_NAME = /potion of healing/i;
const GOODBERRY_NAME = /goodberry/i;

/**
 * AI tactics' "Use Consumable" directive — the server-side equivalent of InventoryTab's click
 * handler (consume, then conditionally heal), collapsed into one call since a tactics step
 * doesn't have a UI event to dispatch two events from. No general effect system exists yet, so
 * anything other than Potion of Healing/Goodberry just gets consumed with no mechanical effect —
 * same as it would from a manual click today.
 */
export async function resolvePlayerItemUse(
  campaignId: string, { characterId, characterName, itemId }: { characterId: string; characterName: string; itemId: string },
): Promise<void> {
  const char = await getCharacter(campaignId, characterId);
  const item = char?.inventory?.find(i => i.id === itemId);
  if (!char || !item) return;

  const quantity = item.quantity - 1;
  await updateCharacter(campaignId, characterId, c => ({
    ...c,
    inventory: quantity > 0
      ? (c.inventory ?? []).map(i => i.id === itemId ? { ...i, quantity } : i)
      : (c.inventory ?? []).filter(i => i.id !== itemId),
  }));
  const sid = playerSocketIds.get(characterId);
  if (sid) io.to(sid).emit('character:inventory:remove', { itemId, quantity: Math.max(0, quantity) });

  const healDice = POTION_OF_HEALING_NAME.test(item.name) ? '2d4+4' : GOODBERRY_NAME.test(item.name) ? '1d1' : null;
  if (healDice) {
    const maxHp = calcMaxHp(char);
    const healAmount = rollDice(healDice);
    const currentHp = Math.min(maxHp, (char.currentHp ?? maxHp) + healAmount);
    await updateCharacter(campaignId, characterId, c => ({ ...c, currentHp, maxHp }));
    const participant = fightOf(campaignId, characterId)?.findParticipant(characterId);
    if (participant) {
      participant.maxHp = maxHp;
      if (participant.heal(healAmount)) {
        await updateCharacter(campaignId, characterId, c => ({ ...c, deathSaves: participant.deathSaves }));
        const sid = playerSocketIds.get(characterId);
        if (sid) io.to(sid).emit('character:reward:update', { characterId });
      }
    }
    io.to(campaignRoom(campaignId)).emit('consumable:heal:result', { characterId, characterName, healAmount, currentHp, maxHp });
  }
}

export function registerInventoryHandlers(ctx: JoinContext): void {
  const { socket, campaignId } = ctx;

  socket.on('character:equipment:update', ({ characterId, slot, itemId }: { characterId: string; slot: 'head' | 'body' | 'gloves' | 'boots' | 'mainHand' | 'offHand'; itemId: string | null }) => {
    void (async () => {
      const char = await getCharacter(campaignId, characterId);
      if (!char) return;
      const isHandSlot = slot === 'mainHand' || slot === 'offHand';
      const otherHand = slot === 'mainHand' ? 'offHand' : 'mainHand';
      const updates: Partial<Record<'head' | 'body' | 'gloves' | 'boots' | 'mainHand' | 'offHand', string | undefined>> = {};

      if (itemId !== null) {
        const item = char.inventory?.find(i => i.id === itemId);
        if (!item) return;
        const validForSlot =
          slot === 'mainHand' ? isWeapon(item) || !!item.lightEmissionRangeFt :
          slot === 'offHand'  ? isWeapon(item) || (isArmor(item) && item.isShield) || !!item.lightEmissionRangeFt :
          isArmor(item) && item.slot === slot;
        if (!validForSlot) return;

        // 5.5e proficiency gate: class must be trained in the weapon's category
        // (simple/martial, read off the free-text properties tag) or the armor's
        // training bucket (light/medium/heavy/shield).
        const weaponProfs = effectiveWeaponProfs(char);
        const armorTraining = effectiveArmorTraining(char);
        const proficient =
          isWeapon(item) ? weaponProfs.includes(item.properties.includes('martial') ? 'martial' : 'simple') :
          isArmor(item) ? (item.isShield ? armorTraining.includes('shield') : item.armorType === 'none' || armorTraining.includes(item.armorType)) :
          true;
        if (!proficient && !(isWeapon(item) && isPactWeapon(char, item))) return;

        if (isHandSlot && isWeapon(item) && item.twoHanded) {
          updates.mainHand = itemId;
          updates.offHand = itemId;
        } else {
          updates[slot] = itemId;
        }
      } else {
        updates[slot] = undefined;
      }

      // A two-handed weapon occupies both hands — displacing it from either hand frees the other.
      if (isHandSlot && !(slot in updates && otherHand in updates)) {
        const otherItemId = char.equipment?.[otherHand];
        const otherItem = otherItemId ? char.inventory?.find(i => i.id === otherItemId) : null;
        if (otherItem && isWeapon(otherItem) && otherItem.twoHanded) updates[otherHand] = undefined;
      }

      const finalEquipment = Object.fromEntries(Object.entries({ ...char.equipment, ...updates }).filter(([, v]) => v !== undefined));
      await updateCharacter(campaignId, characterId, c => ({ ...c, equipment: finalEquipment }));
      for (const [s, id] of Object.entries(updates)) {
        io.to(campaignRoom(campaignId)).emit('character:equipment:update', { characterId, slot: s as typeof slot, itemId: id ?? null });
      }
      setLightSourceFor(campaignId, char.name, characterLightRangeFt({ ...char, equipment: finalEquipment }));
    })();
  });

  // Any consumable click burns one unit of the item, in and out of combat.
  socket.on('consumable:used', ({ characterId, itemId }: { characterId: string; itemId: string }) => {
    void (async () => {
      const char = await getCharacter(campaignId, characterId);
      const item = char?.inventory?.find(i => i.id === itemId);
      if (!char || !item) return;

      const quantity = item.quantity - 1;
      await updateCharacter(campaignId, characterId, c => ({
        ...c,
        inventory: quantity > 0
          ? (c.inventory ?? []).map(i => i.id === itemId ? { ...i, quantity } : i)
          : (c.inventory ?? []).filter(i => i.id !== itemId),
      }));

      const sid = playerSocketIds.get(characterId);
      if (sid) io.to(sid).emit('character:inventory:remove', { itemId, quantity: Math.max(0, quantity) });
    })();
  });

  // AI tab (character sheet): persists the manoeuvre list + the offline/AI-controlled toggle.
  // Private like consumable:used — only the owning character's own client needs to hear it back.
  socket.on('character:tactics:update', ({ characterId, tactics, aiControlled }: { characterId: string; tactics: Manoeuvre[]; aiControlled: boolean }) => {
    void (async () => {
      await updateCharacter(campaignId, characterId, c => ({ ...c, tactics, aiControlled }));
      const sid = playerSocketIds.get(characterId);
      if (sid) io.to(sid).emit('character:tactics:update', { characterId, tactics, aiControlled });
      // Unlike tactics (private), aiControlled needs to reach every client so the party roster's pip/offline styling stays live.
      io.to(campaignRoom(campaignId)).emit('character:aiControlled:update', { characterId, aiControlled });
    })();
  });

  // Potion of Healing (2d4+4, the default) or any other flat-heal consumable (Goodberry's 1 HP,
  // passed as healDice) — works in and out of combat. If combat is active, the encounter's
  // live Participant.currentHp (what damage rolls actually read) must be healed too, or
  // the next hit uses the stale pre-heal number.
  socket.on('consumable:heal', ({ characterId, characterName, healDice }: { characterId: string; characterName: string; healDice?: string }) => {
    void (async () => {
      const char = await getCharacter(campaignId, characterId);
      if (!char) return;

      const maxHp = calcMaxHp(char);
      const healAmount = rollDice(healDice ?? '2d4+4');
      const currentHp = Math.min(maxHp, (char.currentHp ?? maxHp) + healAmount);

      await updateCharacter(campaignId, characterId, c => ({ ...c, currentHp, maxHp }));

      const participant = fightOf(campaignId, characterId)?.findParticipant(characterId);
      if (participant) {
        participant.maxHp = maxHp;
        if (participant.heal(healAmount)) {
          await updateCharacter(campaignId, characterId, c => ({ ...c, deathSaves: participant.deathSaves }));
          const sid = playerSocketIds.get(characterId);
          if (sid) io.to(sid).emit('character:reward:update', { characterId });
        }
      }

      io.to(campaignRoom(campaignId)).emit('consumable:heal:result', { characterId, characterName, healAmount, currentHp, maxHp });
    })();
  });

  // Lockpick / Trap Disarm Kit — same "consumable:used already burned the item, this just applies
  // the effect" split as consumable:heal. Both roll a real DEX check (see resolveLockpickAttempt/
  // resolveTrapDisarmAttempt in dungeon/runtime.ts) against the nearest matching target in range.
  socket.on('consumable:lockpick', ({ characterId, characterName }: { characterId: string; characterName: string }) => {
    void resolveLockpickAttempt(campaignId, characterId, characterName);
  });

  socket.on('consumable:trapdisarm', ({ characterId, characterName }: { characterId: string; characterName: string }) => {
    void resolveTrapDisarmAttempt(campaignId, characterId, characterName);
  });
}
