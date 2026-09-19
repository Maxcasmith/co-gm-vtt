// Party Groups ("split the party") — every character sits on exactly one colour-coded track. The
// party counts as split whenever more than one track is occupied; each such stretch is one
// PartySplit, and chat said during it is tagged with the split + the track(s) that saw it, so it
// can be withheld from other tracks until everyone is back on a single track (no metagaming).

/** Track palette, in the order new tracks are handed out. The colour doubles as the track's id —
 * no two tracks share a colour, so a separate id would only ever mirror it. Hex values live in
 * CSS (keyed by `data-color`), not here. */
export const GROUP_COLORS = ["blue", "red", "green", "yellow", "pink", "purple", "orange", "teal"] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/** The first two tracks always exist; only tracks added after them can be deleted (and only when empty). */
export const PERMANENT_GROUP_TRACKS: readonly GroupColor[] = ["blue", "red"];

export interface PartySplit {
  id: string;
  startedAt: number;
  /** Unset while the split is still live — the party hasn't reunited onto one track yet. */
  endedAt?: number;
}

/** The open-world scene a group is standing in — the SessionManifest fields that describe "here". */
export interface TrackScene {
  currentLocation: string | null;
  npcs: string[];
  factions: string[];
  connectedZones: string[];
}

export interface PartyGroups {
  tracks: GroupColor[];
  /** Character name → the track they're on. */
  members: Record<string, GroupColor>;
  /** Oldest first; at most the last entry can be open (no endedAt). */
  splits: PartySplit[];
  /** While split: each track's own scene, copied from the manifest the first time that track's
   * scene changes (until then it's still standing in the manifest's). Folded back into the
   * manifest and cleared on reunion. */
  scenes?: Partial<Record<GroupColor, TrackScene>>;
}

/** A character nobody has placed yet (new to the party, or groups.json predates them) sits on the first track. */
export function trackOf(groups: PartyGroups, name: string): GroupColor {
  // tracks[0] always exists — the PERMANENT_GROUP_TRACKS can't be removed.
  return groups.members[name] ?? groups.tracks[0]!;
}

/** The split still in progress, if the party is currently split. */
export function activeSplit(groups: PartyGroups): PartySplit | undefined {
  const last = groups.splits.at(-1);
  return last && last.endedAt === undefined ? last : undefined;
}
