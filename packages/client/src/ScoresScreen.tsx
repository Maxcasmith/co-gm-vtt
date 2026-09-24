import type { Character } from 'shared';
import { Button } from './components/Button/Button.tsx';

interface Props {
  roster: Character[];
  onBackToLobby: () => void;
}

type ScoreField = 'enemiesKilled' | 'damageDealt' | 'damageReceived';

const COLUMNS: { field: ScoreField; label: string }[] = [
  { field: 'enemiesKilled', label: 'Kills' },
  { field: 'damageDealt', label: 'Damage Dealt' },
  { field: 'damageReceived', label: 'Damage Taken' },
];

// Every player against every category, the leader of each column marked. Only reachable from the
// Congrats screen at the end of a won dungeon crawl — a crawl's characters exist for that one game,
// so their lifetime counters ARE this game's scores.
export default function ScoresScreen({ roster, onBackToLobby }: Props) {
  const best = Object.fromEntries(COLUMNS.map(({ field }) => [field, Math.max(0, ...roster.map(c => c[field] ?? 0))])) as Record<ScoreField, number>;
  const ranked = [...roster].sort((a, b) => (b.enemiesKilled ?? 0) - (a.enemiesKilled ?? 0) || (b.damageDealt ?? 0) - (a.damageDealt ?? 0));

  return (
    <div className="congrats-page">
      <div className="congrats-page-inner">
        <p className="congrats-eyebrow">Dungeon Cleared</p>
        <h1 className="congrats-title">Scores</h1>
        <div className="scores-table-wrap">
          <table className="scores-table">
            <thead>
              <tr>
                <th>Player</th>
                {COLUMNS.map(({ field, label }) => <th key={field}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {ranked.map(c => (
                <tr key={c.id}>
                  <td className="scores-player">{c.name}</td>
                  {COLUMNS.map(({ field }) => {
                    const value = c[field] ?? 0;
                    return <td key={field} className={`scores-value${value > 0 && value === best[field] ? ' scores-value--best' : ''}`}>{value}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="ghost" className="congrats-finish" onClick={onBackToLobby}>Back to Lobby</Button>
      </div>
    </div>
  );
}
