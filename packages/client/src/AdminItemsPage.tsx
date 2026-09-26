import { useState } from 'react';
import { ABILITY_DEFS } from 'shared';
import { Button } from './components/Button/Button.tsx';
import AdminPageShell from './AdminPageShell.tsx';
import { iconSrcFor } from './ItemIcon.tsx';
import emptyFrameIcon from './assets/icons/Icon-Frame-Blue.jpg';
import { CHARACTER_CREATION_SHOP } from './character-creation/characterCreationShop.ts';
import CreateIconsModal, { type IconCandidate } from './CreateIconsModal.tsx';
import ItemDetailSidebar, { type DetailSubject } from './ItemDetailSidebar.tsx';

// Same resolution ItemIcon uses everywhere else, plus the red "still needs an icon" audit
// highlight this admin view wants — tracked locally since ItemIcon itself is stateless. A freshly
// generated icon just starts resolving on the next mount (see `key={refreshKey}` at the call sites).
function IconCell({ name, iconPath, onClick }: { name: string; iconPath?: string; onClick: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`item-cell${(iconPath || !broken) ? '' : ' item-cell--no-icon'}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <img
        src={iconSrcFor(name, iconPath)}
        alt=""
        className="item-cell-icon"
        onError={e => { setBroken(true); e.currentTarget.onerror = null; e.currentTarget.src = emptyFrameIcon; }}
      />
      <span className="item-cell-name" title={name}>{name}</span>
    </div>
  );
}

interface Props {
  password: string;
  onHome: () => void;
}

// Combat-dock buttons that aren't ABILITY_DEFS entries but still show an icon.
const DOCK_ONLY_ICONS = [
  { name: 'Breath Weapon', description: 'Breath Weapon, a Dragonborn species combat ability icon.' },
  { name: 'Pact Weapon', description: 'Pact Weapon, a Warlock Pact of the Blade combat ability icon.' },
  { name: 'Familiar Attack', description: 'Familiar Attack, a Warlock Pact of the Chain combat ability icon.' },
];

export default function AdminItemsPage({ password, onHome }: Props) {
  const [createIconsOpen, setCreateIconsOpen] = useState(false);
  const [iconsRefreshKey, setIconsRefreshKey] = useState(0);
  const [detailSubject, setDetailSubject] = useState<DetailSubject | null>(null);

  const iconCandidates: IconCandidate[] = [
    ...CHARACTER_CREATION_SHOP.items.filter(item => !item.iconPath).map(item => ({ name: item.name, description: item.description })),
    ...Object.values(ABILITY_DEFS).map(ability => ({ name: ability.label, description: `${ability.label}, a ${ability.class ? `${ability.class} class` : `${ability.species} species`} combat ability icon.` })),
    ...DOCK_ONLY_ICONS,
  ];

  return (
    <>
    <AdminPageShell title="Items" onHome={onHome}>
      <div className="admin-modules-header">
        <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">🎒</span>Items</h2>
        <Button onClick={() => setCreateIconsOpen(true)}>Create Icons</Button>
      </div>

      <div className="item-grid" key={`items-${iconsRefreshKey}`}>
        {CHARACTER_CREATION_SHOP.items.map(item => (
          <IconCell
            key={item.id}
            name={item.name}
            iconPath={item.iconPath}
            onClick={() => setDetailSubject({ name: item.name, description: item.description, iconPath: item.iconPath, raw: item as unknown as Record<string, unknown> })}
          />
        ))}
      </div>

      <div className="admin-modules-header">
        <h2 className="admin-section-title"><span className="admin-section-sigil" aria-hidden="true">✨</span>Combat Abilities</h2>
      </div>

      <div className="item-grid" key={`abilities-${iconsRefreshKey}`}>
        {Object.values(ABILITY_DEFS).map(ability => (
          <IconCell
            key={ability.key}
            name={ability.label}
            onClick={() => setDetailSubject({ name: ability.label, description: `${ability.label}, a ${ability.class ? `${ability.class} class` : `${ability.species} species`} combat ability icon.`, raw: ability as unknown as Record<string, unknown> })}
          />
        ))}
        {DOCK_ONLY_ICONS.map(icon => (
          <IconCell key={icon.name} name={icon.name} onClick={() => setDetailSubject({ ...icon, raw: icon })} />
        ))}
      </div>
    </AdminPageShell>

    <CreateIconsModal
      open={createIconsOpen}
      password={password}
      candidates={iconCandidates}
      onClose={() => setCreateIconsOpen(false)}
      onGenerated={() => setIconsRefreshKey(k => k + 1)}
    />

    <ItemDetailSidebar
      subject={detailSubject}
      password={password}
      onClose={() => setDetailSubject(null)}
      onIconChanged={() => setIconsRefreshKey(k => k + 1)}
    />
    </>
  );
}
