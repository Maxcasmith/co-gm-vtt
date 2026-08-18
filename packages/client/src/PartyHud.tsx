import type { Player } from 'shared';
import { dispatch } from './events.ts';

interface Props {
  connected: Player[];
  portraitUrls: Record<string, string>;
  self: Player;
  hp: Record<string, { current: number; max: number }>;
  selfTempHp?: number;
}

export default function PartyHud({ connected, portraitUrls, self, hp, selfTempHp }: Props) {
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
            onClick={name === self ? () => dispatch('vtt:sheet:opened', {}) : undefined}
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
