import { useState, type DragEvent } from 'react';
import type { GroupColor, PartyGroups } from 'shared';
import { GROUP_COLORS, PERMANENT_GROUP_TRACKS, trackOf } from 'shared';
import { Button } from './components/Button/Button.tsx';

const SELF_DRAG_TYPE = 'application/x-party-group-self';

interface Props {
  groups: PartyGroups;
  /** Every party member, online or not — each gets a tile on whichever track they're on. */
  roster: string[];
  portraitUrls: Record<string, string>;
  self: string;
  /** Mid-fight: the server rejects track changes, so the UI stops offering them. */
  locked: boolean;
  onMove: (track: GroupColor) => void;
  onAddTrack: () => void;
  onRemoveTrack: (track: GroupColor) => void;
  onClose: () => void;
}

export default function PartyGroupsModal({ groups, roster, portraitUrls, self, locked, onMove, onAddTrack, onRemoveTrack, onClose }: Props) {
  const [dragOver, setDragOver] = useState<GroupColor | null>(null);
  // Same fallback RestModal uses — a missing portrait shows the initial, not a broken image.
  const [brokenPortraits, setBrokenPortraits] = useState<Set<string>>(new Set());
  const isSelfDrag = (e: DragEvent) => e.dataTransfer.types.includes(SELF_DRAG_TYPE);
  const selfTrack = trackOf(groups, self);

  return (
    <div className="groups-modal">
      <div className="rest-modal-header">
        <span className="rest-modal-title">Party Groups</span>
        <Button variant="ghost" className="rest-modal-close" onClick={onClose} aria-label="Close">×</Button>
      </div>

      <div className="groups-tracks">
        {groups.tracks.map(track => {
          const members = roster.filter(name => trackOf(groups, name) === track);
          const deletable = !PERMANENT_GROUP_TRACKS.includes(track);
          return (
            <div
              key={track}
              data-color={track}
              className={`groups-track${dragOver === track ? ' groups-track--over' : ''}`}
              onDragOver={e => { if (!locked && isSelfDrag(e)) { e.preventDefault(); setDragOver(track); } }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => { e.preventDefault(); setDragOver(null); if (isSelfDrag(e) && track !== selfTrack) onMove(track); }}
            >
              <div className="groups-track-lane">
                {members.map(name => (
                  <div
                    key={name}
                    className={`groups-tile${name === self ? ' groups-tile--self' : ''}`}
                    draggable={name === self && !locked}
                    onDragStart={e => e.dataTransfer.setData(SELF_DRAG_TYPE, name)}
                    title={name}
                  >
                    {portraitUrls[name] && !brokenPortraits.has(name)
                      ? <img src={portraitUrls[name]} alt={name} draggable={false} onError={() => setBrokenPortraits(prev => new Set(prev).add(name))} />
                      : <span className="groups-tile-initial">{name[0]?.toUpperCase()}</span>}
                  </div>
                ))}
              </div>
              {/* Keyboard-reachable alternative to dragging your own tile here. */}
              {track !== selfTrack && (
                <Button variant="ghost" size="sm" className="groups-track-join" disabled={locked} onClick={() => onMove(track)} aria-label={`Join ${track} group`}>
                  Join
                </Button>
              )}
              {deletable && (
                <Button variant="ghost" size="sm" className="groups-track-delete" disabled={members.length > 0} onClick={() => onRemoveTrack(track)} aria-label={`Delete ${track} group`}>
                  ×
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="rest-footer">
        <Button onClick={onAddTrack} disabled={groups.tracks.length >= GROUP_COLORS.length}>New group</Button>
      </div>
      {locked && <p className="groups-locked">Groups are locked during combat.</p>}
    </div>
  );
}
