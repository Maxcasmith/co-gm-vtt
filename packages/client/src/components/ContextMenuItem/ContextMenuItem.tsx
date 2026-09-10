import './ContextMenuItem.css';

interface Props {
  label: string;
  description?: string;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
  onHover?: () => void;
}

export function ContextMenuItem({ label, description, active, disabled, onSelect, onHover }: Props) {
  return (
    <button
      type="button"
      className={`context-menu-item${active ? ' context-menu-item--active' : ''}`}
      disabled={disabled}
      onMouseEnter={onHover}
      onClick={onSelect}
    >
      <span className="context-menu-item-label">{label}</span>
      {description && <span className="context-menu-item-desc">{description}</span>}
    </button>
  );
}
