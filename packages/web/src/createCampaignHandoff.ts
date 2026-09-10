import type { NavigateFunction } from 'react-router-dom';
import api from './api/client';
import { readUserSession } from './api/userSession';
import { writePendingCampaignTags } from './pages/Signup/journeySession';

// Client runs as a separate app/origin (own port in dev) — a plain sessionStorage write
// here wouldn't survive the cross-origin navigation, so tags travel via query string and
// the client itself reads them on mount (see CreateCampaignPage.tsx).
export const CLIENT_URL = import.meta.env.VITE_CLIENT_URL ?? `http://${window.location.hostname}:5173`;

export function redirectToClientCreate(tags: string[]) {
  window.location.href = `${CLIENT_URL}/create?tags=${encodeURIComponent(tags.join(','))}`;
}

/**
 * Central "Create Campaign" routing decision, used both from the Home page button and
 * after a signup that was triggered by it:
 * - no logged-in user (or lookup fails)        -> caller's own "go to signup" path
 * - logged in, has the cloud product           -> straight into the client's create flow
 * - logged in, desktop only                    -> caller shows the copy/paste instructions modal
 */
export async function resolveCampaignRoute(): Promise<'cloud' | 'desktop' | 'signup'> {
  if (!localStorage.getItem('access_token')) return 'signup';

  try {
    const me = readUserSession() ?? await api.auth.me();
    if (me.products.includes('cloud')) return 'cloud';
    if (me.products.includes('desktop')) return 'desktop';
    return 'signup';
  } catch {
    return 'signup';
  }
}

export async function handleCreateCampaignClick(
  tags: string[],
  navigate: NavigateFunction,
  openDesktopModal: (tags: string[]) => void,
) {
  const route = await resolveCampaignRoute();
  if (route === 'cloud') {
    redirectToClientCreate(tags);
  } else if (route === 'desktop') {
    openDesktopModal(tags);
  } else {
    writePendingCampaignTags(tags);
    navigate('/signup');
  }
}
