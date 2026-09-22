interface Props<K extends string> {
  wordmark: string;
  steps: { key: K; label: string }[];
  currentIndex: number;
  onStepClick?: (key: K) => void;
}

// Shared left rail for the campaign-creation and character-creation wizards. Steps render as
// plain text when onStepClick is omitted (campaign creation can't jump backward mid-generation),
// or as buttons when it's provided (character creation allows jumping to any completed tab).
export function CreateRail<K extends string>({ wordmark, steps, currentIndex, onStepClick }: Props<K>) {
  return (
    <aside className="create-rail">
      <span className="create-rail-wordmark">{wordmark}</span>
      <ol className="create-rail-steps">
        {steps.map((s, i) => (
          <li
            key={s.key}
            className={`create-rail-step ${i === currentIndex ? 'create-rail-step--current' : ''} ${i < currentIndex ? 'create-rail-step--done' : ''}`}
          >
            {onStepClick ? (
              <button type="button" className="create-rail-step-btn" onClick={() => onStepClick(s.key)}>
                {s.label}
              </button>
            ) : (
              <span className="create-rail-step-btn create-rail-step-btn--static">{s.label}</span>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
