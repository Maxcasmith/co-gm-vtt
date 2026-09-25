import type { ReactNode } from 'react';
import { Button } from '../components/Button/Button.tsx';
import './TileGrid.css';

export interface TileGridItem {
  id: string;
  name: string;
  /** Extra line(s) under the name — tags, subtitles. */
  meta?: ReactNode;
  /** Still clickable, just visually de-emphasised (e.g. a spell pool that's already full). */
  dimmed?: boolean;
}

interface Props {
  items: TileGridItem[];
  /** One id for single-select grids, or every selected id for multi-select ones. */
  selectedId: string | string[];
  onSelect: (id: string) => void;
}

export default function TileGrid({ items, selectedId, onSelect }: Props) {
  const selected = Array.isArray(selectedId) ? selectedId : [selectedId];
  return (
    <div className="tile-grid">
      {items.map(item => (
        <Button
          key={item.id}
          variant="ghost"
          className={`tile-grid-item ${selected.includes(item.id) ? 'tile-grid-item--selected' : ''} ${item.dimmed ? 'tile-grid-item--dimmed' : ''}`}
          onClick={() => onSelect(item.id)}
        >
          <span className="tile-grid-item-name">{item.name}</span>
          {item.meta}
        </Button>
      ))}
    </div>
  );
}
