export const API = `http://${window.location.hostname}:3001`;

export function profBonusForLevel(level: number): number {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

export function modNum(score: number) {
  return Math.floor((score - 10) / 2);
}
export function mod(score: number): string {
  const m = modNum(score);
  return m >= 0 ? `+${m}` : `${m}`;
}

export function ActionCostDot({
  cost,
}: {
  cost: "action" | "bonusAction" | "reaction" | null;
}) {
  if (!cost) return null;
  const label =
    cost === "action"
      ? "Action"
      : cost === "bonusAction"
        ? "Bonus Action"
        : "Reaction";
  return (
    <span className={`sheet-cost-dot sheet-cost-dot--${cost}`} title={label} />
  );
}
