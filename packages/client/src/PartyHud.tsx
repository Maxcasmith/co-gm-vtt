import type { GroupColor, Player } from 'shared';
import { dispatch } from './events.ts';
import { Button } from './components/Button/Button.tsx';

interface Props {
  /** Every party member known from the lobby, not just who's currently connected — offline/AI-controlled members still get a card, dimmed. */
  roster: Player[];
  connected: Player[];
  aiControlled: Record<string, boolean>;
  portraitUrls: Record<string, string>;
  characterIds: Record<string, string>;
  self: Player;
  hp: Record<string, { current: number; max: number }>;
  selfTempHp?: number;
  onSelectMember: (characterId: string) => void;
  /** Your current Party Groups track — tints the groups button beside your portrait. */
  selfTrack?: GroupColor | undefined;
  onOpenGroups: () => void;
}

export default function PartyHud({ roster, connected, aiControlled, portraitUrls, characterIds, self, hp, selfTempHp, onSelectMember, selfTrack, onOpenGroups }: Props) {
  if (!roster.length) return null;

  const connectedSet = new Set(connected);
  const ordered = [...roster].sort((a, b) => (a === self ? -1 : b === self ? 1 : 0));

  return (
    <div className="party-hud">
      {ordered.map(name => {
        const stats = hp[name];
        const tempHp = name === self ? selfTempHp : undefined;
        const offline = name !== self && !connectedSet.has(name);
        const card = (
          <div
            key={name}
            className={[
              'party-hud-card',
              name === self && 'party-hud-card--self',
              offline && 'party-hud-card--offline',
            ].filter(Boolean).join(' ')}
            onClick={name === self
              ? () => dispatch('vtt:sheet:opened', {})
              : characterIds[name] ? () => onSelectMember(characterIds[name]!) : undefined}
          >
            <div className="party-hud-avatar">
              {portraitUrls[name]
                ? <img src={portraitUrls[name]} alt={name} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                : null}
              {aiControlled[name] && <span className="party-hud-ai-pip" />}
              {!!tempHp && tempHp > 0 && <span className="party-hud-temp-hp">+{tempHp}</span>}
            </div>
            {stats && stats.max > 0 && (
              <progress className="party-hud-hp" value={Math.max(0, Math.min(stats.current, stats.max))} max={stats.max} />
            )}
            <span className="party-hud-name">{name}</span>
          </div>
        );
        // Sibling of the card, not nested in it — the card itself is already clickable (opens the sheet).
        return name === self ? (
          <div key={name} className="party-hud-self-row">
            {card}
            <Button variant="outline" size="sm" className="party-hud-groups-btn" data-color={selfTrack} onClick={onOpenGroups} aria-label="Party groups">⑂</Button>
          </div>
        ) : card;
      })}
    </div>
  );
}
