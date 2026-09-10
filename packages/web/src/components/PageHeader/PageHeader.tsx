import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { D20Icon } from '../icons/Icons';
import { useUserInitials } from '../../useUserInitials';
import { CLIENT_URL } from '../../createCampaignHandoff';
import '../../styles/parchment.css';

export interface PageHeaderLink {
  label: string;
  href: string;
}

// Every real /web route, plus the one link that deliberately leaves it — the only links the
// shared header ever shows.
const NAV_LINKS: PageHeaderLink[] = [
  { label: 'Home', href: '/' },
  { label: 'About Us', href: '/about' },
  { label: 'Supported Game Systems', href: '/systems' },
  { label: 'Products', href: '/products' },
  { label: 'Play', href: CLIENT_URL },
];

interface PageHeaderProps {
  links?: PageHeaderLink[];
  actions?: ReactNode;
}

export function PageHeader({ links = NAV_LINKS, actions }: PageHeaderProps) {
  const { pathname } = useLocation();
  const initials = useUserInitials();

  const defaultActions = initials !== null ? (
    <Link className="signed-in-avatar" to="/profile" aria-label="Account">
      {initials}
    </Link>
  ) : (
    <>
      <Link className="btn btn--outline btn--primary btn--md" to="/login">Log In</Link>
      <Link className="btn btn--fill btn--primary btn--md" to="/signup">Get Started</Link>
    </>
  );

  return (
    <header className="parchment-nav parchment-container">
      <div className="parchment-nav--brand">
        <D20Icon className="parchment-nav--brand-icon" />
        <div className="parchment-nav--wordmark-group">
          <span className="parchment-nav--wordmark">Untitled AI VTT</span>
          <span className="parchment-nav--tagline">Imagine · Play · Together</span>
        </div>
      </div>
      <nav className="parchment-nav--links">
        {links.map(link => (
          link.href.startsWith('http') ? (
            <a key={link.label} href={link.href}>{link.label}</a>
          ) : (
            <Link key={link.label} to={link.href} className={pathname === link.href ? 'is-active' : undefined}>
              {link.label}
            </Link>
          )
        ))}
      </nav>
      <div className="parchment-nav--actions">{actions ?? defaultActions}</div>
    </header>
  );
}
