import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ContextMenuItem } from './components/ContextMenuItem/ContextMenuItem.tsx';

export interface PaletteItem {
  label: string;
  description?: string;
  disabled?: boolean;
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
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[active];
        if (item && !item.disabled) { item.onSelect(); onClose(); }
      }
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
          <ContextMenuItem
            key={item.label}
            label={item.label}
            description={item.description}
            active={i === active}
            disabled={item.disabled}
            onHover={() => setActive(i)}
            onSelect={() => { item.onSelect(); onClose(); }}
          />
        ))}
      </div>
    </div>
  );
}
