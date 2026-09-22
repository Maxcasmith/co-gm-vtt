import { useState } from 'react';
import { Button } from '../components/Button/Button.tsx';
import InfoTooltip from './InfoTooltip.tsx';

interface Props {
  title: string;
  campaignType: 'campaign' | 'dungeon-crawl';
  tags: string[];
  onTagsChange: (tags: string[]) => void;
  partySize: number;
  onPartySizeChange: (size: number) => void;
}

export default function PromptsStep({
  title, campaignType, tags, onTagsChange, partySize, onPartySizeChange,
}: Props) {
  const [tagInput, setTagInput] = useState('');

  function addTag(raw: string) {
    const trimmed = raw.trim().replace(/,+$/, '');
    if (!trimmed || tags.includes(trimmed)) return;
    onTagsChange([...tags, trimmed]);
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
      setTagInput('');
    } else if (e.key === 'Backspace' && tagInput === '') {
      onTagsChange(tags.slice(0, -1));
    }
  }

  function removeTag(tag: string) {
    onTagsChange(tags.filter(t => t !== tag));
  }

  return (
    <div className="create-step">
      <div className="modal-header">
        <h1 className="modal-title">{title}</h1>
        <p className="modal-hint">Add tags to describe your world. The more you add, the richer the generation.</p>
      </div>

      {campaignType === 'dungeon-crawl' && (
        <label className="modal-label">
          <span className="create-label-row">
            Party Size
            <InfoTooltip text="How many players will be in this dungeon crawl — shapes encounter difficulty and loot." />
          </span>
          <input
            type="number"
            className="modal-select"
            min={1}
            max={8}
            value={partySize}
            onChange={e => onPartySizeChange(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
          />
        </label>
      )}

      <div className="tag-input-area">
        <span className="create-field-title create-label-row" id="world-tags-label">
          World Tags
          <InfoTooltip text="Short descriptive tags — genre, tone, setting. The more you add, the richer the generated world. They also decide which existing dungeon tile art gets reused." />
        </span>
        <div className="tag-chips" role="group" aria-labelledby="world-tags-label">
          {tags.map(tag => (
            <span key={tag} className="tag-chip">
              {tag}
              <Button variant="ghost" className="tag-chip-remove" onClick={() => removeTag(tag)}>×</Button>
            </span>
          ))}
          <input
            className="tag-input"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder={tags.length === 0 ? 'e.g. Gothic Horror, Four kingdoms at war…' : 'Add another tag…'}
            autoFocus
          />
        </div>
        <p className="tag-hint">Press Enter, comma, or click Add to add a tag</p>
        {tagInput.trim() && (
          <Button variant="ghost" className="btn-add-tag" onClick={() => { addTag(tagInput); setTagInput(''); }}>
            + Add
          </Button>
        )}
      </div>
    </div>
  );
}
