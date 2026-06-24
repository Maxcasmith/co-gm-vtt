import { useEffect } from 'react';
import type { CombatVictory } from 'shared';
import './app.css';

export type VictoryData = CombatVictory;

interface Props {
  data: VictoryData;
  onDismiss: () => void;
}

export default function VictoryScreen({ data, onDismiss }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 9000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="victory-overlay" onClick={onDismiss}>
      <div className="victory-card" onClick={e => e.stopPropagation()}>
        <h1 className="victory-title">Victory</h1>
        <p className="victory-subtitle">Enemies defeated</p>
        <ul className="victory-kills">
          {data.kills.map(name => <li key={name}>{name}</li>)}
        </ul>
        <div className="victory-xp">
          <span className="victory-xp-value">+{data.xpPerPlayer} XP</span>
          <span className="victory-xp-label">per adventurer</span>
          <span className="victory-xp-total">({data.totalXp} total)</span>
        </div>
        <button className="victory-dismiss" onClick={onDismiss}>Continue</button>
      </div>
    </div>
  );
}
