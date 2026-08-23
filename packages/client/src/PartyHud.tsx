import type { Player } from 'shared';
import { dispatch } from './events.ts';

interface Props {
  connected: Player[];
  portraitUrls: Record<string, string>;
  characterIds: Record<string, string>;
  self: Player;
  hp: Record<string, { current: number; max: number }>;
  selfTempHp?: number;
  onSelectMember: (characterId: string) => void;
}

export default function PartyHud({ connected, portraitUrls, characterIds, self, hp, selfTempHp, onSelectMember }: Props) {
  if (!connected.length) return null;

  const ordered = [...connected].sort((a, b) => (a === self ? -1 : b === self ? 1 : 0));

  return (
    <div className="party-hud">
      {ordered.map(name => {
        const stats = hp[name];
        const tempHp = name === self ? selfTempHp : undefined;
        return (
          <div
            key={name}
            className={name === self ? 'party-hud-card party-hud-card--self' : 'party-hud-card'}
            onClick={name === self
              ? () => dispatch('vtt:sheet:opened', {})
              : characterIds[name] ? () => onSelectMember(characterIds[name]!) : undefined}
          >
            <div className="party-hud-avatar">
              {portraitUrls[name]
                ? <img src={portraitUrls[name]} alt={name} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                : null}
              {!!tempHp && tempHp > 0 && <span className="party-hud-temp-hp">+{tempHp}</span>}
            </div>
            {stats && stats.max > 0 && (
              <progress className="party-hud-hp" value={Math.max(0, Math.min(stats.current, stats.max))} max={stats.max} />
            )}
            <span className="party-hud-name">{name}</span>
          </div>
        );
      })}
    </div>
  );
}
