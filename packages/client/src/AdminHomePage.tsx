import { Button } from './components/Button/Button.tsx';
import { TileButton } from './components/TileButton/TileButton.tsx';
import AdminPageShell from './AdminPageShell.tsx';
import type { AdminTab } from './AdminLayout.tsx';

interface Tile { tab: AdminTab; label: string; sigil: string; description: string }

const TILES: Tile[] = [
  { tab: 'campaigns', label: 'Campaigns', sigil: '⚔', description: 'Running games — erase chat/session history, save as adventure, delete.' },
  { tab: 'modules', label: 'Adventure Modules', sigil: '📜', description: 'Uploaded modules ready to play from.' },
  { tab: 'tiles', label: 'Tiles', sigil: '🧱', description: 'Generated dungeon tilesets.' },
  { tab: 'props', label: 'Props', sigil: '🗝️', description: 'Generated dungeon prop sprites.' },
  { tab: 'icons', label: 'Icons', sigil: '🖼️', description: 'Item and ability icon frames.' },
  { tab: 'items', label: 'Items', sigil: '🎒', description: 'Shop items and combat abilities — audit and generate icons.' },
  { tab: 'bestiary', label: 'Bestiary', sigil: '🐉', description: 'Generated creature portraits and stat blocks.' },
  { tab: 'storyboard', label: 'Storyboard', sigil: '🎬', description: 'Character storyboard test generation.' },
  { tab: 'plot-hooks', label: 'Plot Hooks', sigil: '📖', description: 'The pool of reusable plot hooks.' },
];

interface Props {
  onNavigate: (tab: AdminTab) => void;
  onOpenSettings: () => void;
}

export default function AdminHomePage({ onNavigate, onOpenSettings }: Props) {
  return (
    <AdminPageShell
      title="Admin"
      homeLabel="← Site Home"
      onHome={() => { window.location.href = '/'; }}
      actions={<Button variant="outline" color="secondary" onClick={onOpenSettings}>Settings</Button>}
    >
      <div className="admin-tile-grid">
        {TILES.map(t => (
          <TileButton
            key={t.tab}
            sigil={t.sigil}
            label={t.label}
            description={t.description}
            onClick={() => onNavigate(t.tab)}
          />
        ))}
      </div>
    </AdminPageShell>
  );
}
