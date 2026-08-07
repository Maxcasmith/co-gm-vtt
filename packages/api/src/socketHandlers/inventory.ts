import { isWeapon, isArmor } from 'shared';
import { getCharacter, updateCharacter } from '../storage.ts';
import { io, ROOM, playerSocketIds } from '../state.ts';
import { rollDice, calcMaxHp } from '../combat/dice.ts';
import type { JoinContext } from './context.ts';

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
          slot === 'mainHand' ? isWeapon(item) :
          slot === 'offHand'  ? isWeapon(item) || (isArmor(item) && item.isShield) :
          isArmor(item) && item.slot === slot;
        if (!validForSlot) return;

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

      await updateCharacter(campaignId, characterId, c => ({
        ...c,
        equipment: Object.fromEntries(Object.entries({ ...c.equipment, ...updates }).filter(([, v]) => v !== undefined)),
      }));
      for (const [s, id] of Object.entries(updates)) {
        io.to(ROOM).emit('character:equipment:update', { characterId, slot: s as typeof slot, itemId: id ?? null });
      }
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

  // Potion of Healing — works in and out of combat, since it doesn't touch encounter state.
  socket.on('consumable:heal', ({ characterId, characterName }: { characterId: string; characterName: string }) => {
    void (async () => {
      const char = await getCharacter(campaignId, characterId);
      if (!char) return;

      const maxHp = calcMaxHp(char);
      const healAmount = rollDice('2d4+4');
      const currentHp = Math.min(maxHp, (char.currentHp ?? maxHp) + healAmount);

      await updateCharacter(campaignId, characterId, c => ({ ...c, currentHp, maxHp }));
      io.to(ROOM).emit('consumable:heal:result', { characterId, characterName, healAmount, currentHp, maxHp });
    })();
  });
}
