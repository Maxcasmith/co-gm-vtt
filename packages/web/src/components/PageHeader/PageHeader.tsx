import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { D20Icon } from '../icons/Icons';
import '../../styles/parchment.css';

export interface PageHeaderLink {
  label: string;
  href: string;
}

// Every real /web route — the only links the shared header ever shows.
const NAV_LINKS: PageHeaderLink[] = [
  { label: 'Home', href: '/' },
  { label: 'About Us', href: '/about' },
  { label: 'Supported Game Systems', href: '/systems' },
  { label: 'Explore', href: '/explore' },
  { label: 'Products', href: '/products' },
];

interface PageHeaderProps {
  links?: PageHeaderLink[];
  actions: ReactNode;
}

export function PageHeader({ links = NAV_LINKS, actions }: PageHeaderProps) {
  const { pathname } = useLocation();

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
          <Link key={link.label} to={link.href} className={pathname === link.href ? 'is-active' : undefined}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="parchment-nav--actions">{actions}</div>
    </header>
  );
}
