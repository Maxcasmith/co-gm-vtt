import { useEffect, useState, type ReactNode } from 'react';
import '../../styles/parchment.css';

interface ParchmentLayoutProps {
  /** Rendered immediately, above the loader — never blocked by page-content load state. */
  header: ReactNode;
  /** Shown in place of the real content until ready — should mirror the page's own layout. */
  skeleton: ReactNode;
  /** Fade the loader out automatically ~400ms after mount. Set false to control it yourself via the setReady callback passed to children. */
  autoReady?: boolean;
  children: ReactNode | ((setReady: (ready: boolean) => void) => ReactNode);
}

export function ParchmentLayout({ header, skeleton, autoReady = true, children }: ParchmentLayoutProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!autoReady) return;
    const t = setTimeout(() => setReady(true), 400);
    return () => clearTimeout(t);
  }, [autoReady]);

  return (
    <div className="parchment-shell">
      {header}
      <div className="parchment-content">
        <div className={`parchment-loader${ready ? ' parchment-loader--done' : ''}`} aria-hidden={ready}>
          {skeleton}
        </div>
        {typeof children === 'function' ? children(setReady) : children}
      </div>
    </div>
  );
}
