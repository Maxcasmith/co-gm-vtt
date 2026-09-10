import type { ReactNode } from 'react';

interface Props {
  eyebrow: string;
  title: string;
  tagline?: string;
  actions?: ReactNode;
  children: ReactNode;
}

// Shared chrome for the top-level game pages — home and saved adventures render
// through this so the atmosphere/header never drifts out of sync between them.
export default function HomePageShell({ eyebrow, title, tagline, actions, children }: Props) {
  return (
    <div className="home">
      <div className="home-atmosphere" aria-hidden="true" />
      <header className="home-header">
        <div className="home-header-titles">
          <span className="home-eyebrow">{eyebrow}</span>
          <h1 className="home-title">
            <span className="home-title-flourish" aria-hidden="true" />
            {title}
            <span className="home-title-flourish" aria-hidden="true" />
          </h1>
          {tagline && <p className="home-tagline">{tagline}</p>}
        </div>
        {actions && <div className="home-header-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
