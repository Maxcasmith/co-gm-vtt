import { useState, type ReactNode } from 'react';
import type { GroupColor } from 'shared';
import type { ChatMessageReceivedPayload } from './events.ts';
import { Button } from './components/Button/Button.tsx';

interface Props {
  /** Every message from one split, in log order, each paired with its index in the full log (pin keys use it). */
  entries: { msg: ChatMessageReceivedPayload; index: number }[];
  /** The split is still going — the server only sends this player's own track, so it opens expanded. */
  live: boolean;
  renderMessage: (msg: ChatMessageReceivedPayload, index: number) => ReactNode;
}

// One party split, inline in the Adventure Log at the point it began: messages stay in time order,
// each with a dot per track (filled = that track saw it), so a line two tracks shared — a merged
// fight — appears once rather than duplicated per track. Chips filter the view per track.
export default function SplitBlock({ entries, live, renderMessage }: Props) {
  const tracks = [...new Set(entries.flatMap(e => e.msg.trackIds ?? []))];
  const [hidden, setHidden] = useState<Set<GroupColor>>(new Set());
  const visible = entries.filter(e => e.msg.trackIds?.some(t => !hidden.has(t)));

  function toggle(track: GroupColor) {
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(track)) next.delete(track); else next.add(track);
      return next;
    });
  }

  return (
    <details className="split-block" open={live}>
      <summary className="split-block-summary">
        {live ? 'The party is split' : 'The party split'} · {tracks.join(', ')} · {entries.length} messages
      </summary>
      {tracks.length > 1 && (
        <div className="split-block-chips">
          {tracks.map(track => (
            <Button key={track} variant="outline" size="sm" data-color={track} className="split-block-chip" aria-pressed={!hidden.has(track)} onClick={() => toggle(track)}>
              {track}
            </Button>
          ))}
        </div>
      )}
      {visible.map(({ msg, index }) => (
        <div key={index} className="split-block-row">
          <span className="split-block-rail" aria-hidden>
            {tracks.map(track => (
              <span key={track} data-color={track} className={`split-block-dot${msg.trackIds?.includes(track) ? ' split-block-dot--on' : ''}`} />
            ))}
          </span>
          {renderMessage(msg, index)}
        </div>
      ))}
      {!live && <div className="split-block-end">reunited</div>}
    </details>
  );
}
