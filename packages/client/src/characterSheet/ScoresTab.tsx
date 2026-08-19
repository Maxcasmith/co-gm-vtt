import type { Character } from "shared";

export function ScoresTab({ character }: { character: Character }) {
  const scores: { label: string; value: number }[] = [
    { label: "Enemies Killed", value: character.enemiesKilled ?? 0 },
    { label: "Total Damage Dealt", value: character.damageDealt ?? 0 },
    { label: "Total Damage Received", value: character.damageReceived ?? 0 },
  ];
  return (
    <div className="sheet-feature-group">
      <p className="sheet-feature-group-title">Scores</p>
      {scores.map((s) => (
        <div key={s.label} className="sheet-score-row">
          <span className="sheet-score-name">{s.label}</span>
          <span className="sheet-score-value">{s.value}</span>
        </div>
      ))}
    </div>
  );
}
