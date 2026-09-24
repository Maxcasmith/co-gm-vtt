import { Button } from '../components/Button/Button.tsx';
import './TileGrid.css';

export interface TileGridItem {
  id: string;
  name: string;
}

interface Props {
  items: TileGridItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function TileGrid({ items, selectedId, onSelect }: Props) {
  return (
    <div className="tile-grid">
      {items.map(item => (
        <Button
          key={item.id}
          variant="ghost"
          className={`tile-grid-item ${selectedId === item.id ? 'tile-grid-item--selected' : ''}`}
          onClick={() => onSelect(item.id)}
        >
          <span className="tile-grid-item-name">{item.name}</span>
        </Button>
      ))}
    </div>
  );
}
