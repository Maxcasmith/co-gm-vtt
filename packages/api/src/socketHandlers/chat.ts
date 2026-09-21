import type { CharacterStats } from 'shared';
import { Weapon as WeaponClass, statMod } from 'shared';
import { listCharacters, getConfig } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { resolveImprovisedAction, generateCombatFlavour } from '../session-processor/imagePrompts.ts';
import { handleAdminCommand } from '../effects.ts';
import { logError } from '../logger.ts';
import { fightOf, dungeonOf } from '../state.ts';
import { D20Roll, rollDice, fmtMod, resolveHit } from '../combat/dice.ts';
import { applyDamageToCreature, applyDamageToPlayer } from '../combat/runtime/damage.ts';
import { rollSavingThrow } from '../combat/runtime/rolls.ts';
import { resolvePlayerItemUse } from './inventory.ts';
import { participantsNearPoint, trySpendAction } from './combat.ts';
import { nearbyObjects, roomAt } from '../dungeon/index.ts';
import { dispatchDMResponse } from '../session.ts';
import { postChat, audienceTracks, toTracks, readChatContext } from '../partyGroups.ts';
import type { JoinContext } from './context.ts';

export function registerChatHandlers(ctx: JoinContext): void {
  const { socket, player, charId, campaignId } = ctx;

  socket.on('chat:message', ({ text, senderName }) => {
    if (text.startsWith('/admin ')) {
      void handleAdminCommand(campaignId, charId, senderName, text.slice(7).trim());
      return;
    }

    void (async () => {
      await postChat(campaignId, { text, senderName, timestamp: Date.now() }, [player]);

      const encounter = fightOf(campaignId, player);
      if (encounter) {
        const currentActor = encounter.currentActor;
        if (currentActor?.name === senderName && currentActor.isPlayer) {
          void (async () => {
            const to = await toTracks(campaignId, await audienceTracks(campaignId, [player]));
            to.emit('dm:thinking', true);
            try {
              const config = await getConfig();
              if (!hasFeatureProvider(config, 'improvisedResolution')) return;
              const recent = (await readChatContext(campaignId, [player])).slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');
              const char = await listCharacters(campaignId).then(cs => cs.find(c => c.name === senderName));
              const enemies = encounter.enemies
                .filter(p => p.creature && !p.creature.isDead())
                .map(p => p.creature!.toStatBlock());

              const inventory = (char?.inventory ?? [])
                .filter(i => i.quantity > 0)
                .map(i => ({ id: i.id, name: i.name, quantity: i.quantity }));

              const dungeon = dungeonOf(campaignId, player);
              const pos = dungeon?.positions?.[player];
              const objects = dungeon && pos ? nearbyObjects(dungeon, pos.gx, pos.gy, 60) : [];
              const room = dungeon && pos ? roomAt(dungeon, pos.gx, pos.gy) : undefined;

              const result = await resolveImprovisedAction({
                playerName: senderName,
                playerClass: char?.class ?? 'Adventurer',
                message: text,
                enemies,
                inventory,
                knownSpells: char?.spells ?? [],
                objects: objects.map(o => ({ id: o.id, name: o.name })),
                ...(room && { roomBounds: { x: room.x, y: room.y, width: room.width, height: room.height } }),
                recentChat: recent,
              }, getFeatureProvider(config, 'improvisedResolution'));
              if (!result) return;

              // Validity checks before any narration is posted — mechanically rejecting the action
              // after the DM has already narrated it happening reads as broken (the flavour text
              // implies success while the action never actually resolved).
              if (result.type !== 'question' && char && !trySpendAction(campaignId, char.id, 'action')) return;

              const dmMsg = { text: result.answer, senderName: 'Virtual DM', timestamp: Date.now() };
              await postChat(campaignId, dmMsg, [player]);

              if (result.type === 'attack' && result.dc && result.damageFormula && result.targetId && char) {
                const statKey = (result.stat ?? 'str') as keyof CharacterStats;
                const roll = new D20Roll().roll();
                const mod = statMod(char.stats[statKey]);
                const total = roll + mod;
                const hit = resolveHit(roll, mod, result.dc);
                const isCrit = roll === 20;
                const dmgRoll = hit ? (isCrit ? rollDice(result.damageFormula) + rollDice(result.damageFormula) : rollDice(result.damageFormula)) : undefined;

                const rollMsg = { text: `${senderName} rolls ${result.stat?.toUpperCase() ?? 'STR'}: ${roll}${fmtMod(mod)} = ${total} vs DC ${result.dc} — ${hit ? `HIT! ${dmgRoll} ${result.damageType ?? ''} damage` : 'MISS'}.`, senderName: 'System', timestamp: Date.now() };
                await postChat(campaignId, rollMsg, [player]);

                if (hit && dmgRoll) {
                  void applyDamageToCreature(campaignId, result.targetId, dmgRoll, { isCrit });
                }

                const weapon = new WeaponClass({
                  id: 'improvised',
                  name: 'improvised action',
                  description: '',
                  quantity: 1,
                  damage: result.damageFormula ?? '',
                  damageType: result.damageType ?? '',
                  attackBonus: 0,
                  range: 5,
                  properties: [],
                });
                const atkResult = {
                  attackerName: senderName,
                  targetName: enemies.find(e => e.id === result.targetId)?.name ?? 'target',
                  targetId: result.targetId,
                  weaponName: weapon.name,
                  isMelee: weapon.range <= 10,
                  d20: roll,
                  attackBonus: mod,
                  statBonus: mod,
                  statName: 'Attack',
                  weaponBonus: 0,
                  total,
                  ac: result.dc,
                  hit,
                  isCrit,
                  damage: dmgRoll,
                  damageFormula: result.damageFormula,
                  remainingHp: encounter.findCreature(result.targetId)?.currentHp,
                  targetDead: encounter.findCreature(result.targetId)?.isDead() ?? false,
                };
                if (hasFeatureProvider(config, 'combatNarration')) {
                  const flavour = await generateCombatFlavour(atkResult, getFeatureProvider(config, 'combatNarration'), text);
                  if (flavour) {
                    const flavourMsg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
                    await postChat(campaignId, flavourMsg, [player]);
                  }
                }
              } else if (result.type === 'use_item' && char) {
                const item = char.inventory?.find(i => i.id === result.itemId);
                if (item) {
                  await resolvePlayerItemUse(campaignId, { characterId: char.id, characterName: senderName, itemId: item.id });
                } else {
                  const rejectMsg = { text: `${senderName} has no such item to use.`, senderName: 'System', timestamp: Date.now() };
                  await postChat(campaignId, rejectMsg, [player]);
                }
              } else if (result.type === 'aoe_damage' && char && result.damageFormula && result.radiusFt) {
                const matchedObject = result.originObjectId ? objects.find(o => o.id === result.originObjectId) : undefined;
                const guessed = !matchedObject && dungeon && room
                  && result.originGx != null && result.originGy != null
                  && result.originGx >= room.x && result.originGx < room.x + room.width
                  && result.originGy >= room.y && result.originGy < room.y + room.height
                  && dungeon.cells[result.originGy]?.[result.originGx] === 1
                  ? { gx: result.originGx, gy: result.originGy }
                  : undefined;
                const origin = matchedObject ?? guessed;

                if (!origin) {
                  const rejectMsg = { text: `${senderName} finds nothing there to target.`, senderName: 'System', timestamp: Date.now() };
                  await postChat(campaignId, rejectMsg, [player]);
                } else {
                  const saveAbility = result.saveAbility ?? 'dex';
                  const dc = result.dc ?? 13;
                  for (const targetId of participantsNearPoint(campaignId, encounter, origin.gx, origin.gy, result.radiusFt)) {
                    const participant = encounter.findParticipant(targetId);
                    if (!participant) continue;

                    const { saved, total } = await rollSavingThrow(campaignId, targetId, saveAbility, dc);
                    const dmgRoll = rollDice(result.damageFormula);
                    const damage = saved ? Math.floor(dmgRoll / 2) : dmgRoll;

                    if (participant.isPlayer) await applyDamageToPlayer(campaignId, participant, damage, { sourceId: char.id });
                    else await applyDamageToCreature(campaignId, targetId, damage, { sourceId: char.id });

                    const saveMsg = {
                      text: `${participant.name} rolls ${saveAbility.toUpperCase()} save: ${total} vs DC ${dc} — ${saved ? 'SAVED' : 'FAILS'}, takes ${damage} ${result.damageType ?? ''} damage.`,
                      senderName: 'System', timestamp: Date.now(),
                    };
                    await postChat(campaignId, saveMsg, [player]);
                  }
                }
              }
            } catch (err) { logError('index:improvisedAction', err); }
            finally { to.emit('dm:thinking', false); }
          })();
          return;
        }
      }

      dispatchDMResponse(campaignId, [player]);
    })();
  });
}
