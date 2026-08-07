import type { CharacterStats } from 'shared';
import { Weapon as WeaponClass, statMod } from 'shared';
import { appendChatLog, listCharacters, getConfig, readChatLog } from '../storage.ts';
import { getFeatureProvider, hasFeatureProvider } from '../providers/index.ts';
import { resolveImprovisedAction, generateCombatFlavour } from '../session-processor/imagePrompts.ts';
import { handleAdminCommand } from '../effects.ts';
import { logError } from '../logger.ts';
import { io, ROOM, combatState, encounters } from '../state.ts';
import { D20Roll, rollDice, fmtMod } from '../combat/dice.ts';
import { applyDamageToCreature } from '../combat/runtime.ts';
import { dispatchDMResponse } from '../session.ts';
import type { JoinContext } from './context.ts';

export function registerChatHandlers(ctx: JoinContext): void {
  const { socket, charId, campaignId } = ctx;

  socket.on('chat:message', ({ text, senderName }) => {
    if (text.startsWith('/admin ')) {
      void handleAdminCommand(campaignId, charId, senderName, text.slice(7).trim());
      return;
    }

    void (async () => {
      const payload = { text, senderName, timestamp: Date.now() };
      await appendChatLog(campaignId, payload);
      io.to(ROOM).emit('chat:message', payload);

      if (combatState.get(campaignId)) {
        const encounter = encounters.get(campaignId);
        const currentActor = encounter?.currentActor;
        if (currentActor?.name === senderName && currentActor.isPlayer) {
          void (async () => {
            try {
              const config = await getConfig();
              if (!hasFeatureProvider(config, 'improvisedResolution')) return;
              const recent = (await readChatLog(campaignId)).slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');
              const char = await listCharacters(campaignId).then(cs => cs.find(c => c.name === senderName));
              const enemies = encounter!.enemies
                .filter(p => p.creature && !p.creature.isDead())
                .map(p => p.creature!.toStatBlock());

              const result = await resolveImprovisedAction({
                playerName: senderName,
                playerClass: char?.class ?? 'Adventurer',
                message: text,
                enemies,
                recentChat: recent,
              }, getFeatureProvider(config, 'improvisedResolution'));
              if (!result) return;

              const dmMsg = { text: result.answer, senderName: 'Virtual DM', timestamp: Date.now() };
              await appendChatLog(campaignId, dmMsg);
              io.to(ROOM).emit('chat:message', dmMsg);

              if (result.type === 'attack' && result.dc && result.damageFormula && result.targetId && char) {
                const statKey = (result.stat ?? 'str') as keyof CharacterStats;
                const roll = new D20Roll().roll();
                const mod = statMod(char.stats[statKey]);
                const total = roll + mod;
                const hit = total >= result.dc;
                const dmgRoll = hit ? rollDice(result.damageFormula) : undefined;

                const rollMsg = { text: `${senderName} rolls ${result.stat?.toUpperCase() ?? 'STR'}: ${roll}${fmtMod(mod)} = ${total} vs DC ${result.dc} — ${hit ? `HIT! ${dmgRoll} ${result.damageType ?? ''} damage` : 'MISS'}.`, senderName: 'System', timestamp: Date.now() };
                await appendChatLog(campaignId, rollMsg);
                io.to(ROOM).emit('chat:message', rollMsg);

                if (hit && dmgRoll) {
                  void applyDamageToCreature(campaignId, result.targetId, dmgRoll);
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
                  d20: roll,
                  attackBonus: mod,
                  statBonus: mod,
                  statName: 'Attack',
                  weaponBonus: 0,
                  total,
                  ac: result.dc,
                  hit,
                  damage: dmgRoll,
                  damageFormula: result.damageFormula,
                  remainingHp: encounter!.findCreature(result.targetId)?.currentHp,
                  targetDead: encounter!.findCreature(result.targetId)?.isDead() ?? false,
                };
                if (hasFeatureProvider(config, 'combatNarration')) {
                  const flavour = await generateCombatFlavour(atkResult, getFeatureProvider(config, 'combatNarration'));
                  if (flavour) {
                    const flavourMsg = { text: flavour, senderName: 'Combat', timestamp: Date.now() };
                    await appendChatLog(campaignId, flavourMsg);
                    io.to(ROOM).emit('chat:message', flavourMsg);
                  }
                }
              }
            } catch (err) { logError('index:improvisedAction', err); }
          })();
          return;
        }
      }

      dispatchDMResponse(campaignId);
    })();
  });
}
