import { useState } from 'react';
import { Button } from '../components/Button/Button.tsx';

// disabledReason: shown muted and previewable, but can't be picked (an invocation's unmet prerequisite).
export interface ChoiceOption { name: string; description: string; disabledReason?: string }

interface Props {
  title: string;
  options: ChoiceOption[];
  selected: string[];
  max?: number; // omit for single-select (always overwrites, no deselect)
  onToggle: (name: string) => void;
}

export default function ChoicePicker({ title, options, selected, max, onToggle }: Props) {
  const [preview, setPreview] = useState(options[0]?.name ?? '');
  const active = options.find(o => o.name === preview) ?? options[0];

  function handleClick(opt: ChoiceOption) {
    setPreview(opt.name);
    if (!opt.disabledReason) onToggle(opt.name);
  }

  return (
    <div className="choice-picker">
      <div className="skill-picker-header">
        <span className="settings-section-title">{title}</span>
        {max !== undefined && (
          <span className={`skill-tab-count ${selected.length === max ? 'skill-tab-count--full' : ''}`}>
            {selected.length}/{max}
          </span>
        )}
      </div>

      <div className="choice-list">
        {options.map(opt => {
          const isMine = selected.includes(opt.name);
          const isFull = (max !== undefined && !isMine && selected.length >= max) || !!opt.disabledReason;
          return (
            <Button
              key={opt.name}
              variant="ghost"
              className={`choice-item${isMine ? ' choice-item--active' : ''}${opt.name === active?.name ? ' choice-item--preview' : ''}${isFull ? ' choice-item--full' : ''}`}
              onClick={() => handleClick(opt)}
            >
              <span className="choice-check">{isMine ? '✓' : ''}</span>
              <span className="choice-name">{opt.name}</span>
            </Button>
          );
        })}
      </div>

      {active && (
        <div className="choice-info">
          <p className="choice-info-name">{active.name}</p>
          {active.disabledReason && <p className="choice-info-req">{active.disabledReason}</p>}
          <p className="choice-info-desc">{active.description}</p>
        </div>
      )}
    </div>
  );
}
