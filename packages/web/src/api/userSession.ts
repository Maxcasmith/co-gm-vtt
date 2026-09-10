import type { FindUserResponse } from 'shared';
import type z from 'zod';

type CachedUser = z.infer<typeof FindUserResponse>;

const SESSION_KEY = 'user-info';

// One /users/me fetch per browser session — every header reads this instead of re-fetching.
export function writeUserSession(user: CachedUser) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } catch {
    // sessionStorage unavailable — callers just refetch next time
  }
}

export function readUserSession(): CachedUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) as CachedUser : null;
  } catch {
    return null;
  }
}

export function clearUserSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // nothing to clear
  }
}
