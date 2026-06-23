interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: 'Space Space',  description: 'Open command palette' },
  { keys: 'Space C',      description: 'Quick chat' },
  { keys: 'Escape',       description: 'Close any overlay' },
];

export default function ShortcutsOverlay({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="sheet-scrim sheet-scrim--centered" onClick={onClose}>
      <div className="shortcuts-panel" onClick={e => e.stopPropagation()}>
        <div className="shortcuts-header">
          <span className="shortcuts-title">Keyboard Shortcuts</span>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <ul className="shortcuts-list">
          {SHORTCUTS.map(s => (
            <li key={s.keys} className="shortcuts-row">
              <kbd className="shortcuts-key">{s.keys}</kbd>
              <span className="shortcuts-desc">{s.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
