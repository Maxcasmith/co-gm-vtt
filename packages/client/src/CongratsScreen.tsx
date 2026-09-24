import { useState } from 'react';
import type { Character, Quest } from 'shared';
import { Button } from './components/Button/Button.tsx';
import ScoresScreen from './ScoresScreen.tsx';
import './app.css';

interface Props {
  dungeonName: string;
  theme?: string;
  quests: Quest[];
  roster: Character[];
  onBackToLobby: () => void;
}

// A won dungeon crawl (game:complete): the goals the party achieved, then on to everyone's scores.
export default function CongratsScreen({ dungeonName, theme, quests, roster, onBackToLobby }: Props) {
  const [showScores, setShowScores] = useState(false);
  if (showScores) return <ScoresScreen roster={roster} onBackToLobby={onBackToLobby} />;

  return (
    <div className="congrats-page">
      <div className="congrats-page-inner">
        <p className="congrats-eyebrow">Dungeon Cleared</p>
        <h1 className="congrats-title">Congratulations</h1>
        <p className="congrats-subtitle">{dungeonName}{theme ? ` — ${theme}` : ''}</p>

        <div className="congrats-quests-section">
          <h2 className="congrats-section-title">Goals Achieved</h2>
          <ul className="congrats-quests">
            {quests.map(q => <li key={q.id}>{q.name}</li>)}
          </ul>
        </div>

        <Button variant="ghost" className="congrats-finish" onClick={() => setShowScores(true)}>View Scores</Button>
      </div>
    </div>
  );
}
