import { randomUUID } from 'crypto';
import { GROUP_COLORS, PERMANENT_GROUP_TRACKS, trackOf, activeSplit, type ChatPayload, type GroupColor, type PartyGroups, type PartySplit, type SessionManifest, type TrackScene } from 'shared';
import { readPartyGroups, writePartyGroups, listCharacters, appendChatLog, readChatLog, getConfig, readManifest, writeManifest, emptyManifest } from './storage.ts';
import { getFeatureProvider, hasFeatureProvider } from './providers/index.ts';
import { buildSplitBranchSummaryPrompt } from './session-processor/prompts.ts';
import { logError } from './logger.ts';
import { io, partyGroups, campaignRoom, fightOf, dungeonById, playerSocketIds, toSockets, type Audience } from './state.ts';
import { roomAt } from './dungeon/index.ts';

export function defaultPartyGroups(): PartyGroups {
  return { tracks: [...PERMANENT_GROUP_TRACKS], members: {}, splits: [] };
}

function occupiedTracks(groups: PartyGroups, roster: string[]): Set<GroupColor> {
  return new Set(roster.map(name => trackOf(groups, name)));
}

export interface SplitTransition { started?: PartySplit; ended?: PartySplit }

// The party is split exactly while more than one track holds someone from the roster — opens a
// split the moment that becomes true, closes it the moment it stops being true. Offline members
// count: they're still standing wherever their track left them.
function syncSplit(groups: PartyGroups, roster: string[], now: number): SplitTransition {
  const split = occupiedTracks(groups, roster).size > 1;
  const open = activeSplit(groups);
  if (split && !open) {
    const started = { id: randomUUID(), startedAt: now };
    groups.splits.push(started);
    return { started };
  }
  if (!split && open) {
    open.endedAt = now;
    return { ended: open };
  }
  return {};
}

/** Mutates `groups`. Returns null (and changes nothing) if `track` doesn't exist. */
export function moveMember(groups: PartyGroups, name: string, track: GroupColor, roster: string[], now = Date.now()): SplitTransition | null {
  if (!groups.tracks.includes(track)) return null;
  groups.members[name] = track;
  return syncSplit(groups, roster, now);
}

/** Mutates `groups`. Returns the new track, or null once every palette colour is in use. A new
 * track belongs to wherever its creator is standing — a group inside a dungeon splits within it. */
export function addTrack(groups: PartyGroups, location?: string | undefined): GroupColor | null {
  const next = GROUP_COLORS.find(c => !groups.tracks.includes(c));
  if (!next) return null;
  groups.tracks.push(next);
  if (location) (groups.locations ??= {})[next] = location;
  return next;
}

/** Mutates `groups`. Only an added (non-permanent) track that nobody on the roster is standing on can go. */
export function removeTrack(groups: PartyGroups, track: GroupColor, roster: string[]): boolean {
  if (PERMANENT_GROUP_TRACKS.includes(track) || !groups.tracks.includes(track)) return false;
  if (occupiedTracks(groups, roster).has(track)) return false;
  groups.tracks = groups.tracks.filter(t => t !== track);
  // Drop stale entries for characters no longer on the roster, so trackOf can't hand back a deleted track.
  for (const [name, t] of Object.entries(groups.members)) if (t === track) delete groups.members[name];
  return true;
}

export async function getPartyGroups(cid: string): Promise<PartyGroups> {
  let groups = partyGroups.get(cid);
  if (!groups) {
    groups = await readPartyGroups(cid) ?? defaultPartyGroups();
    partyGroups.set(cid, groups);
  }
  return groups;
}

export async function savePartyGroups(cid: string, groups: PartyGroups): Promise<void> {
  partyGroups.set(cid, groups);
  await writePartyGroups(cid, groups);
}

// ── Chat routing ────────────────────────────────────────────────────────────────

/** Who a message is about — character names, character ids or creature ids — or 'all' for
 * campaign-wide announcements (session start/end). Anyone named here who is in a fight pulls in
 * every player in that fight, so combat lines reach the whole fight however many tracks it spans. */
export type ChatAudience = 'all' | string[];

/** null = the whole campaign: the party isn't split, the message is for everyone, or nobody in
 * `audience` could be traced to a track (logged — better to over-share than silently drop). */
export async function audienceTracks(cid: string, audience: ChatAudience): Promise<GroupColor[] | null> {
  const groups = await getPartyGroups(cid);
  if (audience === 'all' || !activeSplit(groups)) return null;

  const chars = await listCharacters(cid);
  const names = new Set<string>();
  for (const key of audience) {
    // A fight's audience is all its players — including ones still only claimed (pending), who
    // have no participant for the first moments of a fight while initiative rolls in.
    const fight = fightOf(cid, key);
    if (fight) {
      for (const p of fight.players) if (p.isPlayer) names.add(p.name);
      for (const name of fight.pendingPlayerNames) names.add(name);
    }
    const char = chars.find(c => c.name === key || c.id === key);
    if (char) names.add(char.name);
  }
  if (!names.size) {
    console.warn(`[groups] cid=${cid} couldn't attribute a message to any track (audience=${JSON.stringify(audience)}) — sending to everyone`);
    return null;
  }
  return [...new Set([...names].map(name => trackOf(groups, name)))];
}

/** Everyone on `tracks` (live sockets, resolved now — never stale room membership), or the whole campaign for null. */
export async function toTracks(cid: string, tracks: GroupColor[] | null): Promise<Audience> {
  if (!tracks) return io.to(campaignRoom(cid));
  const [groups, chars] = await Promise.all([getPartyGroups(cid), listCharacters(cid)]);
  return toSockets(chars
    .filter(c => tracks.includes(trackOf(groups, c.name)))
    .map(c => playerSocketIds.get(c.id))
    .filter((sid): sid is string => !!sid));
}

/** While split, stamps which split + tracks saw a message, so history/DM context can be filtered per track. */
export async function tagForSplit(cid: string, tracks: GroupColor[] | null): Promise<SplitTags> {
  const split = tracks ? activeSplit(await getPartyGroups(cid)) : undefined;
  return split && tracks ? { splitId: split.id, trackIds: tracks } : {};
}

type SplitTags = Pick<ChatPayload, 'splitId' | 'trackIds'>;

/** Appends to the chat log and delivers the message to `audience` only — the one way any chat
 * line reaches players, so nothing said by one track while split leaks to another. `emit`
 * replaces the default chat:message delivery for lines that travel as another event
 * (session:recap, roll:result) — it's handed the resolved rooms and split tags to carry along. */
export async function postChat(cid: string, msg: ChatPayload, audience: ChatAudience, emit?: (to: Audience, tags: SplitTags) => void): Promise<void> {
  const tracks = await audienceTracks(cid, audience);
  const tags = await tagForSplit(cid, tracks);
  const tagged = { ...msg, ...tags };
  await appendChatLog(cid, tagged);
  const to = await toTracks(cid, tracks);
  if (emit) emit(to, tags);
  else to.emit('chat:message', tagged);
}

/** What a track's DM context (and its players' history) may include: everything said while the
 * party was together, plus — only while split — the live split's lines this track saw. A closed
 * split's lines are excluded once the party reunites; the reunion summary stands in for them. */
function visibleToTracks(log: ChatPayload[], splitId: string | undefined, tracks: GroupColor[] | null): ChatPayload[] {
  return log.filter(m => !m.splitId || (!!tracks && m.splitId === splitId && !!m.trackIds?.some(t => tracks.includes(t))));
}

/** readChatLog, narrowed to what `audience` is allowed to know about. */
export async function readChatContext(cid: string, audience: ChatAudience): Promise<ChatPayload[]> {
  const [log, tracks, groups] = await Promise.all([readChatLog(cid), audienceTracks(cid, audience), getPartyGroups(cid)]);
  return visibleToTracks(log, activeSplit(groups)?.id, tracks);
}

/** A player's Adventure Log: everything said with the party together, every closed split in full
 * (the party has reunited, so there's nothing left to metagame), and — for the live split — only
 * the lines their current track saw. Bracket-wrapped System lines are DM-only context, never shown. */
export async function chatHistoryFor(cid: string, name: string): Promise<ChatPayload[]> {
  const [log, groups] = await Promise.all([readChatLog(cid), getPartyGroups(cid)]);
  const liveSplitId = activeSplit(groups)?.id;
  const track = trackOf(groups, name);
  return log.filter(m =>
    !(m.senderName === 'System' && /^\[.*\]$/.test(m.text))
    && (!m.splitId || m.splitId !== liveSplitId || !!m.trackIds?.includes(track)));
}

const NON_PLAYER_SENDERS = new Set(['System', 'Combat', 'Virtual DM']);

/** On reunion: one DM-only note per track summarising its branch, appended untagged so every
 * narrator from here on sees it (bracket-wrapped System lines are context the players never see).
 * Falls back to the branch's last few raw lines when no recap provider is configured. */
export async function summarizeClosedSplit(cid: string, split: PartySplit): Promise<void> {
  const branch = (await readChatLog(cid)).filter(m => m.splitId === split.id);
  if (!branch.length) return;
  const config = await getConfig();
  const tracks = [...new Set(branch.flatMap(m => m.trackIds ?? []))];
  for (const track of tracks) {
    const lines = branch.filter(m => m.trackIds?.includes(track));
    const members = [...new Set(lines.map(m => m.senderName).filter(n => !NON_PLAYER_SENDERS.has(n) && !n.endsWith('(Virtual DM)')))];
    const transcript = lines.map(m => `[${m.senderName}]: ${m.text}`).join('\n');
    let summary: string;
    try {
      summary = hasFeatureProvider(config, 'sessionRecap')
        ? (await getFeatureProvider(config, 'sessionRecap').complete(buildSplitBranchSummaryPrompt(`${track} group`, members, transcript))).trim()
        : lines.slice(-8).map(m => `${m.senderName}: ${m.text}`).join(' / ');
    } catch (err) {
      logError('partyGroups:summarizeClosedSplit', err);
      summary = lines.slice(-8).map(m => `${m.senderName}: ${m.text}`).join(' / ');
    }
    await appendChatLog(cid, { text: `[While the party was split, the ${track} group (${members.join(', ')}): ${summary}]`, senderName: 'System', timestamp: Date.now() });
  }
}

// ── Per-track scenes ────────────────────────────────────────────────────────────

function sceneOf(manifest: TrackScene): TrackScene {
  return { currentLocation: manifest.currentLocation, npcs: [...manifest.npcs], factions: [...manifest.factions], connectedZones: [...manifest.connectedZones] };
}

/** The scene `tracks` are in: their own copy while split (the first track's, when a reply spans
 * several — they're standing together), otherwise the manifest's. */
export async function sceneFor(cid: string, manifest: SessionManifest, tracks: GroupColor[] | null): Promise<TrackScene> {
  if (!tracks) return manifest;
  const [first] = tracks; // audienceTracks never returns an empty array — null stands for "nobody attributable"
  return (first && (await getPartyGroups(cid)).scenes?.[first]) || manifest;
}

/** Applies a scene change where it belongs: every audience track's own copy while split (seeded
 * from the manifest on first write), the manifest itself otherwise. */
export async function updateScene(cid: string, tracks: GroupColor[] | null, mutate: (scene: TrackScene) => void): Promise<void> {
  const manifest = await readManifest(cid) ?? emptyManifest();
  if (!tracks) {
    mutate(manifest);
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(cid, manifest);
    return;
  }
  const groups = await getPartyGroups(cid);
  groups.scenes ??= {};
  for (const track of tracks) mutate(groups.scenes[track] ??= sceneOf(manifest));
  await savePartyGroups(cid, groups);
}

/** On reunion, the track everyone ended up on is where the party now stands. Mutates `groups`. */
export async function foldScenesOnReunion(cid: string, groups: PartyGroups, finalTrack: GroupColor): Promise<void> {
  const scene = groups.scenes?.[finalTrack];
  delete groups.scenes;
  if (!scene) return;
  const manifest = await readManifest(cid) ?? emptyManifest();
  Object.assign(manifest, sceneOf(scene), { updatedAt: new Date().toISOString() });
  await writeManifest(cid, manifest);
}

// ── Other groups, for the DM ────────────────────────────────────────────────────

const titleCase = (slug: string) => slug.split('-').map(w => (w[0] ?? '').toUpperCase() + w.slice(1)).join(' ');

/** One line per other occupied track — who, where, fighting or not — so a split group's narrator
 * knows the rest of the party exists elsewhere (distant noise, a shared goal) without ever placing
 * them in this scene. Deterministic, no LLM call. Empty when the party isn't split. */
export async function describeOtherGroups(cid: string, audience: ChatAudience): Promise<string> {
  const tracks = await audienceTracks(cid, audience);
  if (!tracks) return '';
  const [groups, chars, manifest] = await Promise.all([getPartyGroups(cid), listCharacters(cid), readManifest(cid)]);
  const lines: string[] = [];
  for (const track of groups.tracks.filter(t => !tracks.includes(t))) {
    const members = chars.map(c => c.name).filter(n => trackOf(groups, n) === track);
    if (!members.length) continue;
    // Each group is described from the map it's actually standing on.
    const dungeon = dungeonById(cid, groups.locations?.[track]);
    const pos = members.map(n => dungeon?.positions?.[n]).find(p => !!p);
    const room = dungeon && pos ? roomAt(dungeon, pos.gx, pos.gy)?.name : undefined;
    const location = room ?? (groups.scenes?.[track] ?? manifest)?.currentLocation ?? undefined;
    const fighting = members.some(n => fightOf(cid, n));
    lines.push(`- ${track} group (${members.join(', ')}): ${location ? `at ${room ?? titleCase(location)}` : 'location unknown'}, ${fighting ? 'in a fight' : 'exploring'}.`);
  }
  return lines.length
    ? `### Elsewhere — the party is split\nThese characters are NOT in this scene. Never narrate them here or have them act; at most, distant consequences (noise, a light, a shared goal) may reach this group.\n${lines.join('\n')}`
    : '';
}

// ── Where tracks are ────────────────────────────────────────────────────────────

/** The dungeons `tracks` are in (null = the whole party's), ignoring tracks out in the world. */
export async function locationsOfTracks(cid: string, tracks: GroupColor[] | null): Promise<string[]> {
  const groups = await getPartyGroups(cid);
  const which = tracks ?? groups.tracks;
  return [...new Set(which.map(t => groups.locations?.[t]).filter((id): id is string => !!id))];
}

/** Moves `tracks` (null = every track — the party is together) into `dungeonId`, or out to the
 * open world when it's undefined. */
export async function setTrackLocations(cid: string, tracks: GroupColor[] | null, dungeonId: string | undefined): Promise<void> {
  const groups = await getPartyGroups(cid);
  groups.locations ??= {};
  for (const track of tracks ?? groups.tracks) {
    if (dungeonId) groups.locations[track] = dungeonId;
    else delete groups.locations[track];
  }
  await savePartyGroups(cid, groups);
}
