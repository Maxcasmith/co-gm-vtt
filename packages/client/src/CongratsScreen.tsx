import { useEffect } from 'react';
import type { Quest } from 'shared';
import './app.css';

interface Props {
  quests: Quest[];
  onDismiss: () => void;
}

export default function CongratsScreen({ quests, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 9000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="congrats-overlay" onClick={onDismiss}>
      <div className="congrats-card" onClick={e => e.stopPropagation()}>
        <h1 className="congrats-title">Congratulations</h1>
        <p className="congrats-subtitle">{quests.length > 1 ? 'Goals achieved' : 'Goal achieved'}</p>
        <ul className="congrats-quests">
          {quests.map(q => <li key={q.id}>{q.name}</li>)}
        </ul>
        <button className="congrats-dismiss" onClick={onDismiss}>Continue</button>
      </div>
    </div>
  );
}
