import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export interface PaletteItem {
  label: string;
  description?: string;
  onSelect: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
  header?: ReactNode;
}

export default function CommandPalette({ open, onClose, items, header }: Props) {
  const [active, setActive] = useState(0);

  useEffect(() => { if (open) setActive(0); }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % items.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + items.length) % items.length); return; }
      if (e.key === 'Enter') { e.preventDefault(); items[active]?.onSelect(); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, active, items, onClose]);

  if (!open) return null;

  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className="palette" onClick={e => e.stopPropagation()}>
        {header && <div className="palette-header">{header}</div>}
        {items.map((item, i) => (
          <button
            key={item.label}
            className={`palette-item${i === active ? ' palette-item--active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => { item.onSelect(); onClose(); }}
          >
            <span className="palette-item-label">{item.label}</span>
            {item.description && <span className="palette-item-desc">{item.description}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
