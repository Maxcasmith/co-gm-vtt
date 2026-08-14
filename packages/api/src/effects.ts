import type { EnemyStatBlock } from 'shared';
import { statMod } from 'shared';
import { randomUUID } from 'crypto';
import { updateCharacter, listCharacters, readEntity, writeEntity, readManifest, writeManifest, emptyManifest, parseEntityLinks, clearDungeon, getConfig, readChatLog, saveDungeon, saveDungeonAscii, readQuests, writeQuests, loadPartyAllies, savePartyAllies, appendChatLog, readNemeses, writeNemeses } from './storage.ts';
import { getFeatureProvider, hasFeatureProvider } from './providers/index.ts';
import { generateDungeon, toClientDungeon, buildDungeonQuests } from './dungeon/index.ts';
import { Encounter, Team, Participant } from './domain/encounter.ts';
import { Creature } from './domain/creature.ts';
import type { TagEffect, AcquiredItem } from './tag-processor.ts';
import { logDebug } from './logger.ts';
import {
  io, ROOM, dungeons, combatState, enemiesReady, combatStartedAt, encounters, playerSocketIds, microDungeons,
  NEMESIS_COOLDOWN_SESSIONS, NEMESIS_CAP_PER_TARGET, NEMESIS_MAX_DEATHS, ALLY_XP_PER_LEVEL, withLivePositions,
} from './state.ts';
import { D20Roll, toSlug, escalateCr } from './combat/dice.ts';
import { rollPlayerInitiatives, addToTurnOrder, resolveQuest, sweepGameTimeExpiries } from './combat/runtime.ts';
import { generateAndBroadcastEnemies } from './dungeon/runtime.ts';

export async function applyEffects(cid: string, effects: TagEffect[]): Promise<void> {
  await Promise.all(consolidateEffects(effects).map(async effect => {
    if (effect.type === 'combat_init' && !combatState.get(cid)) {
      // Hard guard, not just a prompt instruction: while a real dungeon is loaded, combat must
      // only ever start through the dungeon's own aggro system (checkDungeonProximity /
      // startDungeonCombat), which spawns creatures already placed in dungeon.entities. The DM
      // is told not to emit COMBAT_INIT here, but that's advisory — a model can still slip and
      // emit it (e.g. right after a combat-flavoured victory narration), and if unguarded this
      // routes into the world-map path (generateAndBroadcastEnemies, a fresh LLM call unrelated
      // to any dungeon entity) — a second, parallel combat system running alongside the real one.
      if (dungeons.has(cid)) {
        logDebug(`combat_init ignored — real dungeon already loaded for ${cid}, DM should not have emitted this tag`);
        return;
      }
      combatState.set(cid, true);
      enemiesReady.set(cid, false);
      combatStartedAt.set(cid, Date.now());
      encounters.set(cid, Encounter.empty(cid));
      io.to(ROOM).emit('combat:state', true);
      void listCharacters(cid).then(chars => rollPlayerInitiatives(cid, chars));
      void generateAndBroadcastEnemies(cid, effect.combatants);
    } else if (effect.type === 'inventory_add') {
      const chars = await listCharacters(cid);
      const char = chars.find(c => c.name === effect.player);
      if (!char) return;
      await updateCharacter(cid, char.id, c => ({ ...c, inventory: [...(c.inventory ?? []), ...effect.items] }));
      const sid = playerSocketIds.get(char.id);
      if (sid) io.to(sid).emit('character:inventory:add', effect.items);
    } else if (effect.type === 'scene_build') {
      const locationSlug = effect.locationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = await readEntity(cid, 'location', locationSlug);
      const updated = existing
        ? `${existing.trimEnd()}\n- ${effect.detail}`
        : `# ${effect.locationName}\n\n## Scene Notes\n- ${effect.detail}`;
      await writeEntity(cid, 'location', locationSlug, updated);
      console.log(`[scene] updated location notes: ${locationSlug}`);

      // Update manifest: new current location, parse linked entities from the file
      const links = parseEntityLinks(updated);
      const manifest = await readManifest(cid) ?? emptyManifest();
      manifest.currentLocation = locationSlug;
      manifest.connectedZones = links.locations;
      for (const npc of links.npcs) { if (!manifest.npcs.includes(npc)) manifest.npcs.push(npc); }
      for (const faction of links.factions) { if (!manifest.factions.includes(faction)) manifest.factions.push(faction); }
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(cid, manifest);
      console.log(`[manifest] location → ${locationSlug}, zones: [${links.locations.join(', ')}]`);
    } else if (effect.type === 'npc_build') {
      const npcSlug = effect.npcName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = await readEntity(cid, 'npc', npcSlug);
      const updated = existing
        ? `${existing.trimEnd()}\n- ${effect.detail}`
        : `# ${effect.npcName}\n\n## Observed\n- ${effect.detail}`;
      await writeEntity(cid, 'npc', npcSlug, updated);
      console.log(`[npc] updated npc notes: ${npcSlug}`);

      // Add to manifest so this NPC loads in future prompts
      const manifest = await readManifest(cid) ?? emptyManifest();
      if (!manifest.npcs.includes(npcSlug)) {
        manifest.npcs.push(npcSlug);
        manifest.updatedAt = new Date().toISOString();
        await writeManifest(cid, manifest);
      }
    } else if (effect.type === 'dungeon_gen') {
      const config = await getConfig();
      if (!hasFeatureProvider(config, 'dungeonGeneration')) { console.warn('[dungeon] no models configured — skipping dungeon generation'); return; }
      console.log(`[dungeon] generating: ${effect.name}`);
      io.to(ROOM).emit('dungeon:generating');
      const [recentChat, characters] = await Promise.all([readChatLog(cid), listCharacters(cid)]);
      const storyContext = recentChat.slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');
      const partySize = characters.length || 4;
      const partyLevel = characters.length
        ? Math.round(characters.reduce((sum, c) => sum + (c.level ?? 1), 0) / characters.length)
        : 1;
      const dungeon = await generateDungeon(effect.name, effect.dungeonType, getFeatureProvider(config, 'dungeonGeneration'), storyContext, { partySize, partyLevel });
      dungeons.set(cid, dungeon);
      await saveDungeon(cid, dungeon);
      await saveDungeonAscii(cid, dungeon);
      io.to(ROOM).emit('dungeon:loaded', toClientDungeon(withLivePositions(cid, dungeon)));
      console.log(`[dungeon] generated and broadcast: ${dungeon.name} (${dungeon.rooms.length} rooms, ${dungeon.entities.length} entities)`);

      const quests = buildDungeonQuests(dungeon, await readQuests(cid));
      await writeQuests(cid, quests);
      const questManifest = await readManifest(cid);
      io.to(ROOM).emit('quest:update', { quests, act: questManifest?.act ?? 1 });
    } else if (effect.type === 'dungeon_exit') {
      if (combatState.get(cid) || !dungeons.has(cid)) return; // don't rip the map out from under an active fight, or if there's nothing loaded
      await resolveQuest(cid, 'exit-dungeon');
      dungeons.delete(cid);
      microDungeons.delete(cid);
      await clearDungeon(cid);
      io.to(ROOM).emit('dungeon:cleared');
      console.log('[dungeon] party left — cleared');
    } else if (effect.type === 'party_join') {
      const currentAllies = await loadPartyAllies(cid);
      const alreadyPresent = currentAllies.some(a => a.name === effect.ally.name);
      if (alreadyPresent) return;
      await savePartyAllies(cid, [...currentAllies, effect.ally]);

      const encounter = encounters.get(cid);
      if (encounter && combatState.get(cid)) {
        const playerTeam = encounter.teams.find(t => t.name === 'Players');
        if (!playerTeam) return;
        const creature = Creature.from(effect.ally);
        const p = new Participant({
          id: creature.id,
          name: creature.name,
          initiative: new D20Roll().roll() + statMod(creature.stats.dex),
          isPlayer: false,
          teamId: 'players',
          creature,
          ownerId: effect.ally.ownerId,
        });
        playerTeam.addParticipant(p);
        encounter.expectedParticipantCount += 1;
        addToTurnOrder(cid, [p]);
        const joinMsg = { text: `${creature.name} joins the fight!`, senderName: 'Combat', timestamp: Date.now() };
        io.to(ROOM).emit('chat:message', joinMsg);
        void appendChatLog(cid, joinMsg);
      }
    } else if (effect.type === 'quest_add' || effect.type === 'quest_update' || effect.type === 'quest_resolve') {
      const quests = await readQuests(cid);
      const today = new Date().toISOString().slice(0, 10);

      if (effect.type === 'quest_add') {
        const existing = quests.find(q => q.id === effect.id);
        if (existing) {
          existing.status = 'open';
        } else {
          quests.push({ id: effect.id, name: effect.name, description: effect.description, status: 'open', log: [], addedAt: today });
        }
      } else if (effect.type === 'quest_update') {
        const q = quests.find(q => q.id === effect.id);
        if (q) q.log.push({ date: today, text: effect.entry });
      } else if (effect.type === 'quest_resolve') {
        const q = quests.find(q => q.id === effect.id);
        if (q) q.status = 'resolved';
      }

      await writeQuests(cid, quests);
      const manifest = await readManifest(cid);
      io.to(ROOM).emit('quest:update', { quests, act: manifest?.act ?? 1 });
    } else if (effect.type === 'clock') {
      const manifest = await readManifest(cid) ?? emptyManifest();
      manifest.worldTimeSecs = (manifest.worldTimeSecs ?? 43200) + effect.secs;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(cid, manifest);
      io.to(ROOM).emit('clock:update', { worldTimeSecs: manifest.worldTimeSecs });
      sweepGameTimeExpiries(cid, manifest.worldTimeSecs);
    } else if (effect.type === 'nemesis_create') {
      const slug = toSlug(effect.name);
      const manifest = await readManifest(cid) ?? emptyManifest();
      const records = await readNemeses(cid);
      const existingIdx = records.findIndex(r => r.id === slug);

      if (existingIdx >= 0) {
        const record = records[existingIdx]!;
        if (record.status === 'retired') return;
        record.deathCount += 1;
        record.statBlock = {
          ...record.statBlock,
          hp: Math.round(record.statBlock.hp * 1.3),
          ac: record.statBlock.ac + 1,
          cr: escalateCr(record.statBlock.cr),
        };
        record.cooldownUntilSession = manifest.sessionsPlayed + NEMESIS_COOLDOWN_SESSIONS;
        record.status = record.deathCount >= NEMESIS_MAX_DEATHS ? 'retired' : 'active';
        records[existingIdx] = record;
        console.log(`[nemesis] ${effect.name} returns — death #${record.deathCount}${record.status === 'retired' ? ', retired' : ''}`);
      } else {
        const activeForTarget = records.filter(r => r.boundTo === effect.boundTo && r.status === 'active').length;
        if (activeForTarget >= NEMESIS_CAP_PER_TARGET) {
          console.log(`[nemesis] cap reached for ${effect.boundTo}, skipping ${effect.name}`);
          return;
        }
        const statBlock: EnemyStatBlock = effect.statBlock
          ? { ...effect.statBlock, id: randomUUID(), name: effect.name }
          : { id: randomUUID(), name: effect.name, cr: 0.25, hp: 11, ac: 12, speed: 30, stats: { str: 11, dex: 11, con: 11, int: 8, wis: 8, cha: 8 }, attacks: [{ name: 'Attack', bonus: 3, damage: '1d6+1' }], creatureType: 'Humanoid' };

        records.push({
          id: slug,
          name: effect.name,
          boundTo: effect.boundTo,
          status: 'active',
          deathCount: 0,
          cooldownUntilSession: manifest.sessionsPlayed + NEMESIS_COOLDOWN_SESSIONS,
          statBlock,
          createdAtSession: manifest.sessionsPlayed,
        });

        const today = new Date().toISOString().slice(0, 10);
        const stub = `---\ntype: nemesis\nname: ${effect.name}\nboundTo: ${effect.boundTo}\nstatus: active\ndeathCount: 0\nlast_updated: ${today}\n---\n\n${effect.detail}\n\n## Session Notes\n- ${today}: ${effect.detail}`;
        await writeEntity(cid, 'nemesis', slug, stub);
        console.log(`[nemesis] created: ${effect.name} (bound to ${effect.boundTo})`);
      }
      await writeNemeses(cid, records);
    } else if (effect.type === 'nemesis_retire') {
      const records = await readNemeses(cid);
      const record = records.find(r => r.id === toSlug(effect.name));
      if (!record) return;
      record.status = 'retired';
      await writeNemeses(cid, records);
      console.log(`[nemesis] retired: ${effect.name}`);
    } else if (effect.type === 'ally_xp') {
      const allies = await loadPartyAllies(cid);
      const idx = allies.findIndex(a => a.name.toLowerCase() === effect.allyName.toLowerCase());
      if (idx === -1) return;
      const ally = allies[idx]!;
      const xp = (ally.xp ?? 0) + effect.amount;
      const level = ally.level ?? 1;
      if (xp >= ALLY_XP_PER_LEVEL) {
        allies[idx] = { ...ally, xp: xp - ALLY_XP_PER_LEVEL, level: level + 1, hp: ally.hp + 5, ac: ally.ac + 1 };
        console.log(`[ally] ${ally.name} leveled up to ${level + 1}`);
      } else {
        allies[idx] = { ...ally, xp };
      }
      await savePartyAllies(cid, allies);
    } else if (effect.type === 'ally_learn') {
      const allies = await loadPartyAllies(cid);
      const idx = allies.findIndex(a => a.name.toLowerCase() === effect.allyName.toLowerCase());
      if (idx === -1) return;
      const ally = allies[idx]!;
      allies[idx] = { ...ally, attacks: [...ally.attacks, { name: effect.attackName, bonus: effect.bonus, damage: effect.damageFormula }] };
      await savePartyAllies(cid, allies);
      console.log(`[ally] ${ally.name} learned ${effect.attackName}`);
    }
  }));
}

function buildAdminEffect(tagType: string, name: string, detail: string, player: string): TagEffect | null {
  const id = randomUUID();
  switch (tagType) {
    case 'ADD_INVENTORY_CONSUMABLE':
      return { type: 'inventory_add', player, items: [{ id, type: 'consumable', name, description: detail, quantity: 1, effect: detail, actionCost: 'action' } as AcquiredItem] };
    case 'ADD_INVENTORY_ITEM':
      return { type: 'inventory_add', player, items: [{ id, type: 'item', name, description: detail, quantity: 1 } as AcquiredItem] };
    case 'ADD_INVENTORY_WEAPON':
      return { type: 'inventory_add', player, items: [{ id, type: 'weapon', name, description: detail, quantity: 1, damage: '1d4', damageType: 'bludgeoning', attackBonus: 0, range: 5, properties: [], isFinesse: false } as AcquiredItem] };
    case 'ADD_INVENTORY_AMMO':
      return { type: 'inventory_add', player, items: [{ id, type: 'ammunition', name, description: detail, quantity: parseInt(detail) || 20 } as AcquiredItem] };
    default:
      return null;
  }
}

const ADMIN_HELP = `Admin commands:
• /admin help — show this list
• /admin say "text" — force the Virtual DM to say exactly that text
• /admin [[ADD_INVENTORY_CONSUMABLE:name|description]] — add a consumable to your inventory
• /admin [[ADD_INVENTORY_ITEM:name|description]] — add a generic item to your inventory
• /admin [[ADD_INVENTORY_WEAPON:name|description]] — add a weapon (1d4 bludgeoning, range 5) to your inventory
• /admin [[ADD_INVENTORY_AMMO:name|quantity]] — add ammunition to your inventory

World-building (written to entity files, injected into future DM context):
• [[SCENE_BUILD:Location Name:physical details]] — add spatial facts to a location
• [[NPC_BUILD:NPC Name:observed detail]] — add observed facts to an NPC`;

export async function handleAdminCommand(cid: string, senderId: string, senderName: string, command: string): Promise<void> {
  if (command === 'help') {
    const sid = playerSocketIds.get(senderId);
    if (sid) io.to(sid).emit('chat:message', { text: ADMIN_HELP, senderName: 'System', timestamp: Date.now() });
    return;
  }

  const sayMatch = command.match(/^say\s+"([^"]+)"/);
  if (sayMatch) {
    const payload = { text: sayMatch[1]!, senderName: 'Virtual DM', timestamp: Date.now() };
    await appendChatLog(cid, payload);
    io.to(ROOM).emit('chat:message', payload);
    console.log(`[admin] say: "${sayMatch[1]}"`);
    return;
  }

  const ADMIN_TAG_RE = /\[\[([A-Z_]+):([^|[\]]+)\|([^\]]*)\]\]/g;
  const matches = [...command.matchAll(ADMIN_TAG_RE)];
  if (!matches.length) {
    console.log(`[admin] unrecognised command from ${senderName}: ${command}`);
    return;
  }

  const effects: TagEffect[] = [];
  for (const match of matches) {
    const tagType = match[1]!;
    const name = match[2]!.trim();
    const detail = match[3]!.trim();
    const effect = buildAdminEffect(tagType, name, detail, senderName);
    if (effect) effects.push(effect);
    else console.log(`[admin] unknown tag type: ${tagType}`);
  }

  if (effects.length) {
    await applyEffects(cid, effects);
    console.log(`[admin] applied ${effects.length} effect(s) for ${senderName}`);
  }
}

function consolidateEffects(effects: TagEffect[]): TagEffect[] {
  const result: TagEffect[] = [];
  const inventoryByPlayer = new Map<string, AcquiredItem[]>();
  const sceneByLocation = new Map<string, string[]>();
  const npcByName = new Map<string, string[]>();
  let hasCombatInit = false;
  const combatInitCombatants: string[] = [];

  for (const effect of effects) {
    if (effect.type === 'combat_init') {
      hasCombatInit = true;
      combatInitCombatants.push(...effect.combatants);
    } else if (effect.type === 'inventory_add') {
      const existing = inventoryByPlayer.get(effect.player) ?? [];
      inventoryByPlayer.set(effect.player, [...existing, ...effect.items]);
    } else if (effect.type === 'scene_build') {
      const existing = sceneByLocation.get(effect.locationName) ?? [];
      sceneByLocation.set(effect.locationName, [...existing, effect.detail]);
    } else if (effect.type === 'npc_build') {
      const existing = npcByName.get(effect.npcName) ?? [];
      npcByName.set(effect.npcName, [...existing, effect.detail]);
    } else {
      result.push(effect);
    }
  }

  if (hasCombatInit) result.unshift({ type: 'combat_init', combatants: [...new Set(combatInitCombatants)] });
  for (const [player, items] of inventoryByPlayer) result.push({ type: 'inventory_add', player, items });
  for (const [locationName, details] of sceneByLocation) result.push({ type: 'scene_build', locationName, detail: details.join('\n- ') });
  for (const [npcName, details] of npcByName) result.push({ type: 'npc_build', npcName, detail: details.join('\n- ') });

  return result;
}
