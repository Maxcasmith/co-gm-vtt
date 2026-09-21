// End-to-end check for Party Groups + multi-fight combat, over real sockets against a real
// in-process server, with no LLM (LLM_STUB — see providers/stub.ts). No test framework in this
// repo, so this is the one runnable check:
//   LLM_STUB=1 npx tsx src/partyGroups.integration.selfcheck.ts   (from packages/api)
// Writes a throwaway campaign (never a real one) and deletes it afterwards, pass or fail.
//
// The map: 40×12 floor, a wall down x=20 with a two-cell gap at the top (rows 0–1), so the two
// halves can't see each other but can be walked between.
//
//   west: Aria (3,5) Bex (13,5) Goblin (6,5)       │  east: Cal (27,5) Thief (30,5) Watch (31,5)
//                                                  │        Dax (39,11) — never in any fight
import assert from 'node:assert';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import type { Character, Dungeon, EnemyStatBlock } from 'shared';
import { LLM_STUB } from './providers/stub.ts';
import { deleteCampaign, writeCharacter, getCharacter, readChatLog, saveDungeon } from './storage.ts';
import { setTrackLocations } from './partyGroups.ts';
import { httpServer, sessionState, registerDungeon, unregisterDungeon, dungeonsIn, locationOf, fightOf, fightsIn } from './state.ts';
import { registerSocketHandlers } from './socketHandlers/index.ts';
import { applyDamageToCreature } from './combat/runtime/damage.ts';
import { applyEffects } from './effects.ts';

if (!LLM_STUB) throw new Error('run with LLM_STUB=1 — this check must never call a real model');

const SLUG = '__selfcheck-party-groups__';
const NAMES = ['Aria', 'Bex', 'Cal', 'Dax'] as const;
type Name = (typeof NAMES)[number];
const idOf = (n: string) => `fixture-${n.toLowerCase()}`;

// ── fixture ─────────────────────────────────────────────────────────────────────────────────
function character(name: string): Character {
  return {
    id: idOf(name), campaignId: SLUG, name, species: 'Human', background: 'Soldier', class: 'Fighter', level: 3,
    stats: { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, skillProficiencies: [],
    password: 'x', portraitPath: '', tokenPath: '', createdAt: new Date().toISOString(),
    currentHp: 30, maxHp: 30, xp: 0, inventory: [],
  } as unknown as Character;
}

// Speed 0 and no attacks: creatures take their turns without moving (so they can't wander into
// chain range) or hurting anyone (so nobody drops mid-check).
function creature(id: string, name: string): EnemyStatBlock {
  return { id, name, cr: 1, hp: 500, ac: 10, speed: 0, stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, attacks: [] };
}

const W = 40, H = 12;
const dungeon: Dungeon = {
  id: 'fixture-dungeon', name: 'Split Test Hall', width: W, height: H,
  cells: Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 20 && y > 1 ? 0 : 1))),
  rooms: [],
  entities: [
    { id: 'goblin', type: 'creature', name: 'Goblin Brute', x: 6, y: 5, discovered: true, statBlock: creature('goblin', 'Goblin Brute') },
    { id: 'thief', type: 'creature', name: 'Thief Cutpurse', x: 30, y: 5, discovered: true, statBlock: creature('thief', 'Thief Cutpurse') },
    { id: 'watch', type: 'creature', name: 'Watch Sergeant', x: 31, y: 5, discovered: true, statBlock: creature('watch', 'Watch Sergeant') },
  ],
} as unknown as Dungeon;

const START: Record<Name, { gx: number; gy: number }> = {
  Aria: { gx: 2, gy: 5 }, Bex: { gx: 13, gy: 5 }, Cal: { gx: 27, gy: 5 }, Dax: { gx: 39, gy: 11 },
};

// ── harness ─────────────────────────────────────────────────────────────────────────────────
type Received = { ev: string; args: unknown[] };
const inbox: Record<Name, Received[]> = { Aria: [], Bex: [], Cal: [], Dax: [] };
const sockets = {} as Record<Name, Socket>;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function waitFor(what: string, pred: () => boolean, ms = 8000): Promise<void> {
  const until = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > until) throw new Error(`timed out waiting for: ${what}`);
    await sleep(50);
  }
}
const got = (n: Name, ev: string, match: (a: unknown[]) => boolean = () => true) => inbox[n].some(r => r.ev === ev && match(r.args));
const texts = (n: Name, ev: string) => inbox[n].filter(r => r.ev === ev).map(r => (r.args[0] as { text?: string })?.text ?? '');
const clear = () => { for (const n of NAMES) inbox[n].length = 0; };
const move = (n: Name, gx: number, gy: number) => sockets[n].emit('token:move', { tokenId: n, gx, gy });
const say = (n: Name, text: string) => sockets[n].emit('chat:message', { text, senderName: n });
const groupsMove = (n: Name, track: string) => sockets[n].emit('groups:move', { track: track as never });
const combatEventsFor = (n: Name) => inbox[n].filter(r => /^(combat:(?!log|player:(damage|heal|tempHp|dead|slots|featureResources))|encounter:)/.test(r.ev));

const results: { name: string; ok: boolean; err?: string }[] = [];
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); results.push({ name, ok: true }); console.info(`  ✔ ${name}`); }
  catch (err) { results.push({ name, ok: false, err: (err as Error).message }); console.info(`  ✘ ${name}\n      ${(err as Error).message}`); }
}

async function main(): Promise<void> {
  // The server logs every hook and turn — only show it on request.
  if (process.env.VERBOSE !== '1') console.log = () => {};
  await deleteCampaign(SLUG);
  for (const n of NAMES) await writeCharacter(SLUG, idOf(n), character(n));
  dungeon.positions = Object.fromEntries(NAMES.map(n => [n, START[n]!]));
  registerDungeon(SLUG, dungeon);
  await saveDungeon(SLUG, dungeon);
  // Everyone starts inside the fixture dungeon (every track located there).
  await setTrackLocations(SLUG, null, dungeon.id);
  sessionState.set(SLUG, true);

  registerSocketHandlers();
  await new Promise<void>(r => httpServer.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;

  for (const n of NAMES) {
    const s = connect(url, { transports: ['websocket'], forceNew: true });
    s.onAny((ev: string, ...args: unknown[]) => inbox[n].push({ ev, args }));
    await new Promise<void>(r => s.on('connect', () => r()));
    s.emit('player:join', { name: n, id: idOf(n), campaignId: SLUG });
    sockets[n] = s;
  }
  await waitFor('everyone gets groups:update on join', () => NAMES.every(n => got(n, 'groups:update')));
  await sleep(300);
  clear();

  // ── 1. Tracks + chat routing ──────────────────────────────────────────────────────────────
  console.info('\nTracks & chat');
  await check('outside a running session, splitting and rejoining is refused', async () => {
    sessionState.set(SLUG, false);
    clear();
    groupsMove('Aria', 'red');
    sockets.Aria.emit('groups:track:add');
    await sleep(500);
    assert.ok(!got('Aria', 'groups:update'), 'a group change went through with no session running');
    sessionState.set(SLUG, true);
  });

  await check('moving Aria to red opens a split and tells everyone', async () => {
    groupsMove('Aria', 'red');
    await waitFor('groups:update with Aria on red', () => NAMES.every(n => got(n, 'groups:update', a => (a[0] as { members: Record<string, string> }).members['Aria'] === 'red')));
    const g = inbox.Bex.filter(r => r.ev === 'groups:update').at(-1)!.args[0] as { splits: { endedAt?: number }[] };
    assert.equal(g.splits.length, 1);
    assert.equal(g.splits[0]!.endedAt, undefined);
  });

  await check('red chat reaches only red; its stub DM heard only Aria', async () => {
    clear();
    say('Aria', 'I sneak down the side passage');
    await waitFor('Aria gets the DM reply', () => got('Aria', 'session:recap'));
    await sleep(300);
    assert.ok(texts('Aria', 'chat:message').includes('I sneak down the side passage'));
    for (const n of ['Bex', 'Cal', 'Dax'] as const) {
      assert.ok(!texts(n, 'chat:message').includes('I sneak down the side passage'), `${n} saw red's chat`);
      assert.ok(!got(n, 'session:recap'), `${n} got red's DM reply`);
      assert.ok(!got(n, 'dm:thinking'), `${n} saw red's DM thinking`);
    }
    const reply = texts('Aria', 'session:recap')[0]!;
    assert.match(reply, /heard:Aria(\s|$)/, `red's DM context should hold only Aria — got "${reply}"`);
    assert.match(reply, /elsewhere:yes/, 'red DM should get the Elsewhere block');
  });

  await check('blue chat reaches only blue; its stub DM never heard Aria', async () => {
    clear();
    say('Bex', 'We hold the main hall');
    await waitFor('Bex gets the DM reply', () => got('Bex', 'session:recap'));
    await sleep(300);
    assert.ok(got('Cal', 'session:recap') && got('Dax', 'session:recap'), 'the rest of blue should get the reply');
    assert.ok(!got('Aria', 'session:recap') && !texts('Aria', 'chat:message').includes('We hold the main hall'), 'Aria (red) saw blue');
    const reply = texts('Bex', 'session:recap')[0]!;
    assert.ok(!reply.includes('Aria'), `blue's DM context leaked red — "${reply}"`);
  });

  await check("each group's DM can see what the other groups have been doing", async () => {
    clear();
    say('Cal', 'We search the common room');
    await waitFor('blue gets its DM reply', () => got('Bex', 'session:recap'));
    await sleep(300);
    const reply = texts('Bex', 'session:recap').at(-1)!;
    // Red (Aria) spoke earlier in this split — blue's narrator must be handed that transcript.
    assert.match(reply, /others:red=[1-9]/, `blue's DM should see red's transcript — got "${reply}"`);
    assert.ok(!reply.includes('heard:Aria'), "red's lines must stay out of blue's own conversation turns");
  });

  await check('reuniting closes the split: everyone gets the full history, DM gets a hidden summary', async () => {
    clear();
    groupsMove('Aria', 'blue');
    await waitFor('chat:history to everyone', () => NAMES.every(n => got(n, 'chat:history')));
    for (const n of NAMES) {
      const h = (inbox[n].find(r => r.ev === 'chat:history')!.args[0] as { text: string; splitId?: string }[]);
      assert.ok(h.some(m => m.text === 'I sneak down the side passage' && m.splitId), `${n} history missing red's branch`);
      assert.ok(h.some(m => m.text === 'We hold the main hall' && m.splitId), `${n} history missing blue's branch`);
      assert.ok(!h.some(m => m.text.startsWith('[While the party was split')), `${n} can see the DM-only summary`);
    }
    let log = await readChatLog(SLUG);
    for (let i = 0; i < 40 && log.filter(m => m.text.startsWith('[While the party was split')).length < 2; i++) {
      await sleep(100);
      log = await readChatLog(SLUG);
    }
    assert.ok(log.some(m => m.text.startsWith('[While the party was split, the red group')), 'no red branch summary for the DM');
    assert.ok(log.some(m => m.text.startsWith('[While the party was split, the blue group')), 'no blue branch summary for the DM');
  });

  // Dax goes off alone on red for the rest of the run — the isolated bystander.
  groupsMove('Dax', 'red');
  await waitFor('Dax on red', () => got('Aria', 'groups:update', a => (a[0] as { members: Record<string, string> }).members['Dax'] === 'red'));

  // ── 2. Chain rule ─────────────────────────────────────────────────────────────────────────
  console.info('\nChain rule & fights');
  await check('Aria aggroes the goblin: Bex (7 cells from it, in sight) is chained in, Cal behind the wall is not', async () => {
    clear();
    move('Aria', 3, 5);
    await waitFor('Aria in a fight', () => got('Aria', 'combat:state', a => a[0] === true));
    await waitFor('Bex in the same fight', () => got('Bex', 'combat:state', a => a[0] === true));
    await sleep(400);
    assert.equal(fightOf(SLUG, 'Aria'), fightOf(SLUG, 'Bex'));
    assert.equal(fightOf(SLUG, 'Cal'), undefined);
    assert.ok(!got('Cal', 'combat:state', a => a[0] === true), 'Cal got combat:state');
    assert.equal(combatEventsFor('Dax').length, 0, 'Dax received combat events');
    assert.equal(texts('Dax', 'chat:message').length, 0, `Dax (red) saw fight chat: ${JSON.stringify(texts('Dax', 'chat:message'))}`);
  });

  await check('Cal starts his own fight on the other side of the wall — two fights at once', async () => {
    clear();
    move('Cal', 28, 5);
    await waitFor('Cal in a fight', () => got('Cal', 'combat:state', a => a[0] === true));
    await sleep(600);
    assert.equal(fightsIn(SLUG).length, 2);
    assert.notEqual(fightOf(SLUG, 'Cal'), fightOf(SLUG, 'Aria'));
    assert.ok(!got('Aria', 'encounter:ready'), "Aria saw Cal's enemies");
    assert.equal(combatEventsFor('Dax').length, 0, 'Dax (8+ cells from everyone) received combat events');
  });

  await check('stub sides: the Thief and the Watch land on different, mutually hostile sides', async () => {
    await waitFor('sides assigned', () => {
      const f = fightOf(SLUG, 'Cal');
      return !!f && f.findParticipant('thief')?.teamId !== f.findParticipant('watch')?.teamId;
    });
    const f = fightOf(SLUG, 'Cal')!;
    const thief = f.findParticipant('thief')!;
    assert.ok(f.hostilesOf(thief).some(p => p.id === 'watch'), 'Watch should be hostile to the Thief');
    assert.ok(f.hostilesOf(thief).some(p => p.name === 'Cal'), 'Cal should be hostile to the Thief');
  });

  await check('changing track mid-fight is refused', async () => {
    clear();
    groupsMove('Cal', 'red');
    await sleep(500);
    assert.ok(!got('Cal', 'groups:update'), 'a mid-fight track change went through');
  });

  await check('only the current actor can end the turn', async () => {
    const f = fightOf(SLUG, 'Aria')!;
    await waitFor("a player's turn in the west fight", () => !!f.currentRound && !!f.currentActor?.isPlayer, 15000);
    const actor = f.currentActor!;
    const other = actor.name === 'Aria' ? 'Bex' : 'Aria';
    sockets[other].emit('combat:turn:end');
    await sleep(400);
    assert.equal(f.currentActor?.id, actor.id, `${other} ended ${actor.name}'s turn`);
  });

  // ── 3. Merge ──────────────────────────────────────────────────────────────────────────────
  await check('Cal walks through the gap into chain range: the two fights merge into the older one', async () => {
    clear();
    const west = fightOf(SLUG, 'Aria')!;
    move('Cal', 21, 1);
    await sleep(250);
    move('Cal', 19, 0);
    await sleep(250);
    move('Cal', 14, 4);
    await waitFor('one fight left', () => fightsIn(SLUG).length === 1);
    assert.equal(fightOf(SLUG, 'Cal'), west, 'the older (west) fight should absorb the newer one');
    assert.ok(west.findParticipant('thief') && west.findParticipant('goblin'));
    await waitFor("Aria gets the merged fight's enemies", () => got('Aria', 'encounter:ready', a => (a[0] as { id: string }[]).some(e => e.id === 'thief')));
    assert.equal(combatEventsFor('Dax').length, 0, 'Dax received combat events');
  });

  // ── 4. Victory ────────────────────────────────────────────────────────────────────────────
  await check('victory: XP only to the fight\'s players, victory screen only to them', async () => {
    clear();
    for (const id of ['goblin', 'thief', 'watch']) await applyDamageToCreature(SLUG, id, 9999);
    await waitFor('victory to the fighters', () => (['Aria', 'Bex', 'Cal'] as const).every(n => got(n, 'combat:victory')));
    assert.ok(!got('Dax', 'combat:victory'), 'Dax got the victory screen');
    await sleep(300);
    const xp = Object.fromEntries(await Promise.all(NAMES.map(async n => [n, (await getCharacter(SLUG, idOf(n)))?.xp ?? 0])));
    assert.ok(xp['Aria']! > 0 && xp['Aria'] === xp['Bex'] && xp['Bex'] === xp['Cal'], `fighters' XP ${JSON.stringify(xp)}`);
    assert.equal(xp['Dax'], 0, 'Dax earned XP for a fight he was never in');
    await waitFor('combat:state false after the victory window', () => got('Aria', 'combat:state', a => a[0] === false), 10000);
    assert.equal(fightsIn(SLUG).length, 0);
  });

  // ── 5. Split across places: one group in the dungeon, one out in the world ────────────────
  console.info('\nSplit locations');
  await setTrackLocations(SLUG, ['red'], undefined); // Dax (red) steps out into the world

  await check('a group out in the world sees none of the dungeon group\'s map', async () => {
    clear();
    move('Aria', 4, 5);
    await waitFor('Bex sees Aria move', () => got('Bex', 'token:moved'));
    await sleep(300);
    assert.ok(!got('Dax', 'token:moved'), "Dax (world) saw the dungeon group's tokens");
    assert.ok(!got('Dax', 'dungeon:loaded'), 'Dax (world) got the dungeon map');
  });

  await check('the world group starts its own open-world fight, on its own arena', async () => {
    clear();
    say('Dax', 'attack!');
    await waitFor('Dax in a fight', () => got('Dax', 'combat:state', a => a[0] === true));
    await sleep(800);
    const fight = fightOf(SLUG, 'Dax');
    assert.ok(fight?.arenaId, 'the open-world fight should have its own arena');
    assert.equal(locationOf(SLUG, 'Dax'), fight!.arenaId);
    assert.equal(dungeonsIn(SLUG).length, 2, 'the dungeon and the arena should both be loaded');
    // The arena is the map the fight is played on — its fighters must be sent it, or their client
    // keeps rendering wherever they were before (the world map / their old exploration map).
    assert.ok(got('Dax', 'dungeon:loaded', a => (a[0] as { id: string }).id === fight!.arenaId), 'Dax never received the arena map');
    const arenaPayload = inbox.Dax.filter(r => r.ev === 'dungeon:loaded').map(r => r.args[0] as { id: string; occupants?: string[] }).at(-1)!;
    assert.ok(arenaPayload.occupants?.includes('Dax'), `arena occupants should list its fighters — got ${JSON.stringify(arenaPayload.occupants)}`);
    // Ordering matters: generating the enemies is a model call taking seconds in real play. The
    // battle map must be on screen before them, or the fighters sit in combat mode looking at the
    // map they just left until it returns.
    const mapAt = inbox.Dax.findIndex(r => r.ev === 'dungeon:loaded' && (r.args[0] as { id: string }).id === fight!.arenaId);
    const enemiesAt = inbox.Dax.findIndex(r => r.ev === 'encounter:ready');
    assert.ok(mapAt >= 0 && (enemiesAt === -1 || mapAt < enemiesAt), `the arena map must arrive before the enemies (map@${mapAt}, enemies@${enemiesAt})`);
    for (const n of ['Aria', 'Bex', 'Cal'] as const) {
      assert.equal(fightOf(SLUG, n), undefined, `${n} was pulled into the world group's fight`);
      assert.ok(!got(n, 'dungeon:loaded'), `${n} (in the dungeon) got the arena map`);
    }
    assert.equal(locationOf(SLUG, 'Aria'), dungeon.id, 'the dungeon group should still be in the dungeon');
  });

  await check('joining a group inside a dungeon you are not in is refused', async () => {
    clear();
    groupsMove('Dax', 'blue');
    await sleep(500);
    assert.ok(!got('Dax', 'groups:update'), 'Dax joined a group inside a dungeon he is not in');
    assert.equal(locationOf(SLUG, 'Dax'), fightOf(SLUG, 'Dax')?.arenaId);
  });

  await check('the dungeon is discarded once its last group leaves', async () => {
    clear();
    await applyEffects(SLUG, [{ type: 'dungeon_exit' }], ['Aria']);
    await waitFor('the dungeon group gets dungeon:cleared', () => got('Aria', 'dungeon:cleared'));
    assert.ok(!got('Dax', 'dungeon:cleared'), "Dax (world) got the dungeon group's cleared event");
    assert.ok(!dungeonsIn(SLUG).some(d => d.id === dungeon.id), 'the emptied dungeon should be discarded');
    assert.equal(locationOf(SLUG, 'Aria'), undefined, 'the group that left should be out in the world');
  });
}

main()
  .catch(err => { results.push({ name: 'harness', ok: false, err: (err as Error).stack ?? String(err) }); })
  .finally(async () => {
    for (const s of Object.values(sockets)) s.close();
    await deleteCampaign(SLUG).catch(() => {});
    const failed = results.filter(r => !r.ok);
    console.info(`\n${results.length - failed.length}/${results.length} passed`);
    for (const f of failed) console.info(`FAILED: ${f.name}\n  ${f.err}`);
    process.exit(failed.length ? 1 : 0);
  });
