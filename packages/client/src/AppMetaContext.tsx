import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Platform = 'web' | 'desktop';

interface AppMeta {
  platform: Platform;
}

const AppMetaContext = createContext<AppMeta | null>(null);

const API = `http://${window.location.hostname}:3001`;

export function useAppMeta(): AppMeta {
  const ctx = useContext(AppMetaContext);
  if (!ctx) throw new Error('useAppMeta must be used inside AppMetaProvider');
  return ctx;
}

export function AppMetaProvider({ children }: { children: ReactNode }) {
  // Desktop is the no-env-file default (see authMiddleware's DEPLOY_TARGET split) — assume it
  // until /api/config says otherwise, rather than flashing web-only UI before the fetch lands.
  const [platform, setPlatform] = useState<Platform>('desktop');

  useEffect(() => {
    fetch(`${API}/api/config`)
      .then(r => r.json())
      .then((data: { platform?: Platform }) => { if (data.platform) setPlatform(data.platform); })
      .catch(() => {});
  }, []);

  return <AppMetaContext.Provider value={{ platform }}>{children}</AppMetaContext.Provider>;
}
