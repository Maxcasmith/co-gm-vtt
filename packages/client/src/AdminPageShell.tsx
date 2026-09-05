import type { ReactNode } from 'react';

interface Props {
  title: string;
  onHome: () => void;
  homeLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
}

// Shared chrome for every admin page — the tile-grid home and each resource page all render
// through this so the gate/header/atmosphere never drifts out of sync between them.
export default function AdminPageShell({ title, onHome, homeLabel = '← Admin Home', actions, children }: Props) {
  return (
    <div className="admin-panel">
      <div className="admin-atmosphere" aria-hidden="true" />
      <div className="admin-header">
        <button className="btn-secondary admin-header-link admin-header-link--left" onClick={onHome}>{homeLabel}</button>
        <div className="admin-header-titles">
          <span className="home-eyebrow">Dungeon Master&apos;s Study</span>
          <h1 className="admin-title">
            <span className="home-title-flourish" aria-hidden="true" />
            {title}
            <span className="home-title-flourish" aria-hidden="true" />
          </h1>
        </div>
        {actions && <div className="admin-header-link admin-header-link--right admin-header-link-group">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
