import type { Character, Dungeon, Quest } from 'shared';
import './app.css';

interface Props {
  dungeon: Dungeon;
  quests: Quest[];
  roster: Character[];
  onFinish: () => void;
}

const SCORE_CATEGORIES: { field: 'damageDealt' | 'damageReceived' | 'enemiesKilled'; label: string; unit: string }[] = [
  { field: 'damageDealt', label: 'Dealt the Most Damage', unit: 'dmg' },
  { field: 'damageReceived', label: 'Took the Most Damage', unit: 'dmg' },
  { field: 'enemiesKilled', label: 'Most Enemies Defeated', unit: 'kills' },
];

// Highest value in `roster` for one score field — undefined if nobody's ever logged any (a fresh
// party, or a category this dungeon never touched), so that row is skipped rather than shown as a 0-way tie.
function topScorer(roster: Character[], field: 'damageDealt' | 'damageReceived' | 'enemiesKilled'): { name: string; value: number } | undefined {
  return roster
    .map(c => ({ name: c.name, value: c[field] ?? 0 }))
    .filter(s => s.value > 0)
    .sort((a, b) => b.value - a.value)[0];
}

export default function CongratsScreen({ dungeon, quests, roster, onFinish }: Props) {
  return (
    <div className="congrats-page">
      <div className="congrats-page-inner">
        <p className="congrats-eyebrow">Dungeon Cleared</p>
        <h1 className="congrats-title">Congratulations</h1>
        <p className="congrats-subtitle">{dungeon.name}{dungeon.theme ? ` — ${dungeon.theme}` : ''}</p>

        <div className="congrats-quests-section">
          <h2 className="congrats-section-title">Goals Achieved</h2>
          <ul className="congrats-quests">
            {quests.map(q => <li key={q.id}>{q.name}</li>)}
          </ul>
        </div>

        <div className="congrats-leaderboard-section">
          <h2 className="congrats-section-title">Party Leaderboard</h2>
          <ul className="congrats-leaderboard">
            {SCORE_CATEGORIES.map(({ field, label, unit }) => {
              const top = topScorer(roster, field);
              if (!top) return null;
              return (
                <li key={field} className="congrats-leaderboard-row">
                  <span className="congrats-leaderboard-label">{label}</span>
                  <span className="congrats-leaderboard-winner">{top.name}</span>
                  <span className="congrats-leaderboard-value">{top.value} {unit}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <button className="congrats-finish" onClick={onFinish}>Finish</button>
      </div>
    </div>
  );
}
