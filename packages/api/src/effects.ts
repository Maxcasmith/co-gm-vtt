import type { AppConfig, Character, EnemyStatBlock, GroupColor } from 'shared';
import { addCurrency, removeCurrency, trackOf } from 'shared';
import { randomUUID } from 'crypto';
import { updateCharacter, listCharacters, readEntity, writeEntity, readManifest, writeManifest, emptyManifest, parseEntityLinks, clearDungeon, getConfig, saveDungeon, saveDungeonAscii, readQuests, writeQuests, loadPartyAllies, savePartyAllies, readNemeses, writeNemeses, getWorldMeta, findVisitedDungeonByName } from './storage.ts';
import { getFeatureProvider, hasFeatureProvider } from './providers/index.ts';
import { generateDungeon, toClientDungeon, broadcastDungeon } from './dungeon/index.ts';
import { generateDungeonQuests } from './session-processor/index.ts';
import { Encounter, Participant, PLAYERS_TEAM_ID } from './domain/encounter.ts';
import { Creature } from './domain/creature.ts';
import type { TagEffect, AcquiredItem } from './tag-processor.ts';
import { logDebug, logError, logTagDebug } from './logger.ts';
import {
  io, campaignRoom, dungeonById, registerDungeon, unregisterDungeon, occupantsOf, locationOf, playerSocketIds, campaignPlayers, connected, fightOf, fightsIn, registerFight,
  NEMESIS_COOLDOWN_SESSIONS, NEMESIS_CAP_PER_TARGET, NEMESIS_MAX_DEATHS, ALLY_XP_PER_LEVEL, markDungeonGenerating,
} from './state.ts';
import { rollInitiative, dexLine, toSlug, escalateCr } from './combat/dice.ts';
import { rollPlayerInitiatives, addToTurnOrder, syncFight } from './combat/runtime/lifecycle.ts';
import { sweepGameTimeExpiries } from './combat/runtime/environment.ts';
import { trySpendSpellSlot } from './combat/runtime/resources.ts';
import { generateAndBroadcastEnemies, openArena, unlockDoorNear, resolveLockpickAttempt, resolveTrapDisarmAttempt } from './dungeon/runtime.ts';
import { checkQuestChainTriggers } from './dungeon/questChain.ts';
import { advancePlotArc } from './plotArcs.ts';
import { findSpell } from './routes/spells.ts';
import { postChat, audienceTracks, updateScene, sceneFor, readChatContext, getPartyGroups, setTrackLocations, locationsOfTracks, toTracks, type ChatAudience } from './partyGroups.ts';

// A player name in a tag comes from the model's narration, not a dropdown — it's never going to
// reproduce a stored name's exact casing/whitespace byte-for-byte (a character sheet with a
// trailing-space name is real data in this app, e.g. "Ken-doll Ride-man "). The ally-name lookups
// below already compare case-insensitively; this brings player-character lookups up to the same
// standard instead of silently dropping the item/currency/spell-slot spend on a whitespace mismatch.
function findCharByName(chars: Character[], name: string): Character | undefined {
  const norm = name.trim().toLowerCase();
  return chars.find(c => c.name.trim().toLowerCase() === norm);
}

// Mirrors InventoryTab's click-handler name match (no general item-effects table exists — see
// socketHandlers/inventory.ts's identical POTION_OF_HEALING_NAME comment) — kept in sync manually.
const LOCKPICK_NAME = /lockpick/i;
const TRAP_DISARM_KIT_NAME = /trap disarm kit/i;

type QuestEffect = Extract<TagEffect, { type: 'quest_add' | 'quest_update' | 'quest_resolve' }>;
const isQuestEffect = (e: TagEffect): e is QuestEffect =>
  e.type === 'quest_add' || e.type === 'quest_update' || e.type === 'quest_resolve';

/**
 * Puts the party back into a dungeon they've already visited, restored exactly as they left it.
 * Returns false when the name doesn't resolve to a stored map — the model claimed a return visit
 * to somewhere it has never actually been, or to a place from before dungeons were kept — and the
 * caller then generates a new one, which is the pre-existing behaviour.
 */
async function reopenStoredDungeon(cid: string, name: string, tracks: GroupColor[] | null): Promise<boolean> {
  const stored = await findVisitedDungeonByName(cid, name);
  if (!stored) {
    console.log(`[dungeon] reopen requested for "${name}" but no stored map matches — generating instead`);
    return false;
  }
  // Already loaded (another group is in there right now) — registerDungeon would replace the live
  // object and discard whatever they've discovered since it was last written.
  const live = dungeonById(cid, stored.id);
  const dungeon = live ?? stored;
  if (!live) registerDungeon(cid, dungeon);
  await setTrackLocations(cid, tracks, dungeon.id);
  broadcastDungeon(cid, dungeon);
  console.log(`[dungeon] reopened ${dungeon.name} (${dungeon.rooms.length} rooms) — not regenerated`);
  return true;
}

/**
 * The whole dungeon_gen pipeline, detached from applyEffects so the DM's narration reaches the
 * party while it runs (see the call site). Because it's detached, nothing upstream can catch its
 * failures — so every exit path here has to tell the waiting clients something, or the loading
 * screen they're sitting behind never comes down.
 */
async function generateDungeonForTracks(
  cid: string,
  effect: Extract<TagEffect, { type: 'dungeon_gen' }>,
  tracks: GroupColor[] | null,
  audience: ChatAudience,
  config: AppConfig,
): Promise<void> {
  try {
    const [recentChat, characters] = await Promise.all([readChatContext(cid, audience), listCharacters(cid)]);
    const storyContext = recentChat.slice(-10).map(m => `[${m.senderName}]: ${m.text}`).join('\n');
    const partySize = characters.length || 4;
    const partyLevel = characters.length
      ? Math.round(characters.reduce((sum, c) => sum + (c.level ?? 1), 0) / characters.length)
      : 1;
    // Generated first so the floor plan can be designed to actually serve the quest, not the
    // other way around — dungeonId is decided up front so this is tagged and written before
    // the dungeon itself exists, never the untagged/orphaned quest ensureSessionQuests avoids.
    // At most one stage comes back (see buildDungeonQuestPrompt) — the manifest call below
    // decides its trigger plus the entire rest of the chain, same as the campaign-creation path.
    const dungeonId = randomUUID();
    const predefinedQuests = await generateDungeonQuests(cid, dungeonId, effect.name, effect.dungeonType, storyContext, config);
    if (predefinedQuests.length) {
      await writeQuests(cid, [...(await readQuests(cid)), ...predefinedQuests]);
      io.to(campaignRoom(cid)).emit('quest:update', { quests: await readQuests(cid), act: (await readManifest(cid))?.act ?? 1 });
    }
    const predefinedChain = predefinedQuests.map(q => ({ id: q.id, name: q.name, description: q.description }));

    const worldMeta = await getWorldMeta(cid);
    const dungeon = await generateDungeon(effect.name, effect.dungeonType, getFeatureProvider(config, 'dungeonGeneration'), storyContext, { partySize, partyLevel, id: dungeonId, predefinedChain, ...(worldMeta?.genre ? { genre: worldMeta.genre } : {}) }, undefined, config);
    registerDungeon(cid, dungeon);
    // The groups this narration was for are the ones who walked in; everyone else stays put.
    await setTrackLocations(cid, tracks, dungeon.id);
    await saveDungeon(cid, dungeon);
    await saveDungeonAscii(cid, dungeon);
    broadcastDungeon(cid, dungeon);
    console.log(`[dungeon] generated and broadcast: ${dungeon.name} (${dungeon.rooms.length} rooms, ${dungeon.entities.length} entities)`);
  } catch (err) {
    logError('effects:generateDungeonForTracks', err);
    // Releases the loading screen and the input lockout behind it. The party stays where they
    // were — setTrackLocations only runs on the success path above, so a failure leaves them in
    // the world they were already standing in rather than stranded in a dungeon that doesn't exist.
    const waiting = await toTracks(cid, tracks);
    waiting.emit('dungeon:failed');
    waiting.emit('chat:message', { text: `[The way ahead doesn't open — ${effect.name} could not be generated.]`, senderName: 'System', timestamp: Date.now() });
  } finally {
    // finally, not per-branch: a reconnecting player must never be handed a loading screen for a
    // generation that already finished or died.
    markDungeonGenerating(cid, tracks, false);
  }
}

/** `audience` — whose DM turn produced these effects (see ChatAudience): while the party is split,
 * scene changes land on that group's own scene instead of everyone's. 'all' for campaign-wide sources. */
export async function applyEffects(cid: string, effects: TagEffect[], audience: ChatAudience): Promise<void> {
  const consolidated = consolidateEffects(effects);
  for (const effect of consolidated) logTagDebug(`apply ${cid} audience=${audience === 'all' ? 'all' : audience.join(',')} ${JSON.stringify(effect)}`);
  const questEffects = consolidated.filter(isQuestEffect);
  const otherEffects = consolidated.filter(e => !isQuestEffect(e));
  const tracks = await audienceTracks(cid, audience);

  // Quest effects all read-modify-write the same quests.json — run them as one sequential
  // batch (single read, single write) instead of racing inside the Promise.all below, where
  // two quest tags from the same DM turn could otherwise clobber each other's write.
  if (questEffects.length) await applyQuestEffects(cid, questEffects, tracks);

  await Promise.all(otherEffects.map(async effect => {
    if (effect.type === 'combat_init') {
      // Hard guard, not just a prompt instruction: while a real dungeon is loaded, combat must
      // only ever start through the dungeon's own aggro system (checkDungeonProximity /
      // startDungeonCombat), which spawns creatures already placed in dungeon.entities. The DM
      // is told not to emit COMBAT_INIT here, but that's advisory — a model can still slip and
      // emit it (e.g. right after a combat-flavoured victory narration), and if unguarded this
      // routes into the world-map path (generateAndBroadcastEnemies, a fresh LLM call unrelated
      // to any dungeon entity) — a second, parallel combat system running alongside the real one.
      // Open world has no positions to chain from — the fight is whichever group the DM was
      // narrating for (everyone online, with the party together), minus anyone already fighting.
      const groups = await getPartyGroups(cid);
      const fighters = (campaignPlayers.get(cid) ?? []).filter(name =>
        connected.has(name) && !fightOf(cid, name) && (!tracks || tracks.includes(trackOf(groups, name))));
      if (!fighters.length) return;
      // Hard guard, not just a prompt instruction: inside a dungeon, combat must only ever start
      // through the dungeon's own aggro system (checkDungeonProximity / startDungeonCombat), which
      // spawns creatures already placed in dungeon.entities. Only this group's own location matters
      // — another group being in a dungeon says nothing about where these players are standing.
      if (fighters.some(name => locationOf(cid, name))) {
        logDebug(`combat_init ignored — ${cid}'s acting group is in a dungeon, DM should not have emitted this tag`);
        return;
      }
      const fight = Encounter.empty(cid);
      fight.pendingPlayerNames.push(...fighters);
      registerFight(cid, fight);
      await rollPlayerInitiatives(cid, fight, await listCharacters(cid), fighters);
      // Arena first, enemies second: generating them is a model call, and the fight's players
      // should be looking at the battle map while it runs, not at the map they just left.
      openArena(cid, fight);
      syncFight(fight);
      void generateAndBroadcastEnemies(cid, fight, effect.combatants);
    } else if (effect.type === 'inventory_add') {
      const chars = await listCharacters(cid);
      const char = findCharByName(chars, effect.player);
      if (!char) { console.warn(`[inventory_add] no character named "${effect.player}" — item(s) dropped`); logTagDebug(`DROPPED inventory_add — no character "${effect.player}"`); return; }
      await updateCharacter(cid, char.id, c => ({ ...c, inventory: [...(c.inventory ?? []), ...effect.items] }));
      const sid = playerSocketIds.get(char.id);
      if (sid) io.to(sid).emit('character:inventory:add', effect.items);
    } else if (effect.type === 'currency_add' || effect.type === 'currency_remove') {
      const chars = await listCharacters(cid);
      const char = findCharByName(chars, effect.player);
      if (!char) { console.warn(`[${effect.type}] no character named "${effect.player}" — ${effect.amount} ${effect.denom} dropped`); logTagDebug(`DROPPED ${effect.type} — no character "${effect.player}"`); return; }
      const next = effect.type === 'currency_add'
        ? addCurrency(char, effect.denom, effect.amount)
        : removeCurrency(char, effect.denom, effect.amount);
      await updateCharacter(cid, char.id, c => ({ ...c, [effect.denom]: next }));
      const sid = playerSocketIds.get(char.id);
      // No piecemeal currency state on the client (gold was never live-updated before this) —
      // same "refetch the whole character" pattern rest/combat-end already use.
      if (sid) io.to(sid).emit('character:currency:update', { characterId: char.id });
    } else if (effect.type === 'spell_cast') {
      await resolveSpellCast(cid, effect.player, effect.spellName);
    } else if (effect.type === 'scene_build') {
      const locationSlug = effect.locationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = await readEntity(cid, 'location', locationSlug);
      const updated = existing
        ? `${existing.trimEnd()}\n- ${effect.detail}`
        : `# ${effect.locationName}\n\n## Scene Notes\n- ${effect.detail}`;
      await writeEntity(cid, 'location', locationSlug, updated);
      console.log(`[scene] updated location notes: ${locationSlug}`);

      // Update the scene (the group's own while split, else the manifest): new current location, parse linked entities from the file
      const links = parseEntityLinks(updated);
      await updateScene(cid, tracks, scene => {
        scene.currentLocation = locationSlug;
        scene.connectedZones = links.locations;
        for (const npc of links.npcs) { if (!scene.npcs.includes(npc)) scene.npcs.push(npc); }
        for (const faction of links.factions) { if (!scene.factions.includes(faction)) scene.factions.push(faction); }
      });
      console.log(`[scene] location → ${locationSlug}${tracks ? ` (tracks ${tracks.join(',')})` : ''}, zones: [${links.locations.join(', ')}]`);
    } else if (effect.type === 'npc_build') {
      const npcSlug = effect.npcName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = await readEntity(cid, 'npc', npcSlug);
      const updated = existing
        ? `${existing.trimEnd()}\n- ${effect.detail}`
        : `# ${effect.npcName}\n\n## Observed\n- ${effect.detail}`;
      await writeEntity(cid, 'npc', npcSlug, updated);
      console.log(`[npc] updated npc notes: ${npcSlug}`);

      // Add to the scene so this NPC loads in future prompts
      await updateScene(cid, tracks, scene => { if (!scene.npcs.includes(npcSlug)) scene.npcs.push(npcSlug); });
    } else if (effect.type === 'dungeon_gen') {
      const config = await getConfig();
      if (!hasFeatureProvider(config, 'dungeonGeneration')) { console.warn('[dungeon] no models configured — skipping dungeon generation'); return; }
      // A place they've been before: its map is still on disk with everything they explored,
      // killed and looted intact, so re-open it instead of building a different dungeon behind the
      // same name. No generation, no loading screen — it's already there.
      if (effect.reopen && await reopenStoredDungeon(cid, effect.name, tracks)) return;
      console.log(`[dungeon] generating: ${effect.name}`);
      (await toTracks(cid, tracks)).emit('dungeon:generating');
      markDungeonGenerating(cid, tracks, true);
      // Deliberately NOT awaited. applyEffects runs before the DM's narration is emitted
      // (session.ts), so awaiting a full dungeon generation here held the narration back until the
      // map was already built — the party saw nothing at all for the whole generation, then the
      // announcement and the finished dungeon at once. Detaching it lets the announcement land
      // immediately after the tag fires, which is what the loading screen is shown over.
      void generateDungeonForTracks(cid, effect, tracks, audience, config);
    } else if (effect.type === 'dungeon_exit') {
      // Only the group this narration was for leaves. Never mid-fight.
      const leaving = await toTracks(cid, tracks);
      for (const dungeonId of await locationsOfTracks(cid, tracks)) {
        const dungeon = dungeonById(cid, dungeonId);
        if (!dungeon || fightsIn(cid).some(f => f.arenaId === dungeonId)) continue;
        // Must run before the dungeon is dropped below — checkQuestChainTriggers reads its questChain.
        await checkQuestChainTriggers(cid, { kind: 'exit_dungeon' }, dungeon);
        await setTrackLocations(cid, tracks, undefined);
        leaving.emit('dungeon:cleared');
        // Kept loaded while another group is still inside it; unloaded once the last one leaves.
        if (occupantsOf(cid, dungeonId).length) { console.log(`[dungeon] a group left ${dungeon.name} — others still inside`); continue; }
        unregisterDungeon(cid, dungeonId);
        // Dropped from memory but deliberately NOT from disk. dungeons/<id>.json is written
        // continuously during play, so it's already a complete record of what the party explored,
        // killed and looted — deleting it was throwing that away and forcing a brand new dungeon
        // on the next visit. Kept so returning re-opens the same place (see reopenStoredDungeon).
        // Arenas are exempt: they're transient, and are deleted by the victory path instead.
        if (dungeon.arena) await clearDungeon(cid, dungeonId);
        console.log(`[dungeon] last group left ${dungeon.name} — unloaded${dungeon.arena ? ' and cleared' : ', kept for re-entry'}`);
      }
    } else if (effect.type === 'door_unlock') {
      await unlockDoorNear(cid, effect.characterName);
    } else if (effect.type === 'item_used') {
      // Narrated equivalent of InventoryTab's click (consumable:used decrements, then a bespoke
      // handler applies the effect) — this does both in one step since there's no UI event pair
      // to split it across. Anything other than Lockpick/Trap Disarm Kit just gets consumed with
      // no mechanical effect, same as any other consumable with no bespoke handler.
      const chars = await listCharacters(cid);
      const char = findCharByName(chars, effect.characterName);
      const item = char?.inventory?.find(i => i.name.toLowerCase() === effect.itemName.toLowerCase());
      if (!char || !item) { console.warn(`[item_used] no "${effect.itemName}" in ${effect.characterName}'s inventory`); logTagDebug(`DROPPED item_used — no "${effect.itemName}" in ${effect.characterName}'s inventory`); return; }

      const quantity = item.quantity - 1;
      await updateCharacter(cid, char.id, c => ({
        ...c,
        inventory: quantity > 0
          ? (c.inventory ?? []).map(i => i.id === item.id ? { ...i, quantity } : i)
          : (c.inventory ?? []).filter(i => i.id !== item.id),
      }));
      const sid = playerSocketIds.get(char.id);
      if (sid) io.to(sid).emit('character:inventory:remove', { itemId: item.id, quantity: Math.max(0, quantity) });

      if (LOCKPICK_NAME.test(item.name)) await resolveLockpickAttempt(cid, char.id, char.name);
      else if (TRAP_DISARM_KIT_NAME.test(item.name)) await resolveTrapDisarmAttempt(cid, char.id, char.name);
    } else if (effect.type === 'party_join') {
      const currentAllies = await loadPartyAllies(cid);
      const alreadyPresent = currentAllies.some(a => a.name === effect.ally.name);
      if (alreadyPresent) return;
      await savePartyAllies(cid, [...currentAllies, effect.ally]);

      // Joins its owner's fight, if they're in one — not some other group's.
      const encounter = effect.ally.ownerId ? fightOf(cid, effect.ally.ownerId) : undefined;
      if (encounter) {
        const playerTeam = encounter.team(PLAYERS_TEAM_ID, 'Players');
        const creature = Creature.from(effect.ally);
        const p = new Participant({
          id: creature.id,
          name: creature.name,
          initiativeRoll: rollInitiative(creature, [dexLine(creature.stats)]),
          isPlayer: false,
          teamId: PLAYERS_TEAM_ID,
          creature,
          ownerId: effect.ally.ownerId,
        });
        playerTeam.addParticipant(p);
        encounter.expectedParticipantCount += 1;
        addToTurnOrder(cid, encounter, [p]);
        const joinMsg = { text: `${creature.name} joins the fight!`, senderName: 'Combat', timestamp: Date.now() };
        void postChat(cid, joinMsg, [creature.id]);
      }
    } else if (effect.type === 'clock') {
      const manifest = await readManifest(cid) ?? emptyManifest();
      manifest.worldTimeSecs = (manifest.worldTimeSecs ?? 43200) + effect.secs;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(cid, manifest);
      io.to(campaignRoom(cid)).emit('clock:update', { worldTimeSecs: manifest.worldTimeSecs });
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

async function applyQuestEffects(cid: string, effects: QuestEffect[], tracks: GroupColor[] | null): Promise<void> {
  const quests = await readQuests(cid);
  const today = new Date().toISOString().slice(0, 10);
  // Read once for the whole batch — a live guess should never clobber a better-grounded
  // pre-seeded relatedLocation, and there's no need to re-read per effect for that.
  const manifest = await readManifest(cid);
  const scene = manifest ? await sceneFor(cid, manifest, tracks) : null;

  for (const effect of effects) {
    if (effect.type === 'quest_add') {
      const existing = quests.find(q => q.id === effect.id);
      const relatedNpc = existing?.relatedNpc ?? effect.relatedNpc;
      const relatedLocation = existing?.relatedLocation ?? scene?.currentLocation ?? undefined;
      if (existing) {
        existing.status = 'open';
        if (relatedNpc) existing.relatedNpc = relatedNpc;
        if (relatedLocation) existing.relatedLocation = relatedLocation;
      } else {
        quests.push({
          id: effect.id, name: effect.name, description: effect.description, status: 'open', log: [], addedAt: today,
          ...(relatedNpc ? { relatedNpc } : {}), ...(relatedLocation ? { relatedLocation } : {}),
        });
      }
    } else if (effect.type === 'quest_update') {
      const q = quests.find(q => q.id === effect.id);
      if (q) q.log.push({ date: today, text: effect.entry });
    } else if (effect.type === 'quest_resolve') {
      const q = quests.find(q => q.id === effect.id);
      if (q) q.status = 'resolved';
      // If this quest was the live beat of a plot arc, this pushes the next beat into `quests`
      // (or drops the finished arc) — must run before the write below picks it up.
      await advancePlotArc(cid, effect.id, quests);
    }
  }

  await writeQuests(cid, quests);
  io.to(campaignRoom(cid)).emit('quest:update', { quests, act: manifest?.act ?? 1 });
}

/**
 * The one place an exploration-mode spell cast resolves its resource cost — cantrips are free,
 * anything else spends a real slot via the same trySpendSpellSlot combat uses, and blocks
 * privately if none remain. Both the DM's own [[CAST_SPELL:...]] tag (a freeform journal message)
 * and the journal's cast-spell UI control route through this exact function, so there's one
 * source of truth for "did this cast actually cost anything" regardless of which one triggered it.
 */
export async function resolveSpellCast(cid: string, playerName: string, spellName: string): Promise<{ ok: boolean; charId?: string }> {
  const chars = await listCharacters(cid);
  const char = findCharByName(chars, playerName);
  if (!char) { console.warn(`[spell_cast] no character named "${playerName}"`); return { ok: false }; }
  const spell = findSpell(spellName);
  const slotLevel = spell?.level ?? 0; // unknown spell name — treat as free rather than blocking a real cast over a lookup miss
  const spent = slotLevel === 0 ? true : await trySpendSpellSlot(cid, char.id, char, slotLevel);
  if (!spent) {
    const sid = playerSocketIds.get(char.id);
    // Private to the caster, not persisted — matches checkTrapAt's alert-only message, the
    // one other "blocked" style notice outside combat's own combat:attack:blocked convention.
    if (sid) io.to(sid).emit('chat:message', { text: `No spell slots left to cast ${spellName}.`, senderName: 'System', timestamp: Date.now() });
    return { ok: false, charId: char.id };
  }
  return { ok: true, charId: char.id };
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
    await postChat(cid, payload, [senderName]);
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
    await applyEffects(cid, effects, [senderName]);
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
