import { useEffect, useState } from 'react';
import api from './api/client';
import { readUserSession } from './api/userSession';

const PLACEHOLDER_INITIALS = 'U';

function initialsFor(user: { firstName: string; lastName: string }): string {
  return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() || PLACEHOLDER_INITIALS;
}

// null = logged out (no token). Non-null = logged in. The access token is only exchanged
// for user info once per browser session — cached in sessionStorage by AuthService.me() —
// so every header reads that cache instead of re-fetching /users/me on every mount.
export function useUserInitials(): string | null {
  const [initials, setInitials] = useState<string | null>(() => {
    if (!localStorage.getItem('access_token')) return null;
    const cached = readUserSession();
    return cached ? initialsFor(cached) : PLACEHOLDER_INITIALS;
  });

  useEffect(() => {
    if (!localStorage.getItem('access_token') || readUserSession()) return;
    api.auth.me()
      .then(user => setInitials(initialsFor(user)))
      .catch(() => {});
  }, []);

  return initials;
}
