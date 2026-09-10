import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../../api/client';
import { readUserSession } from '../../api/userSession';

interface RequireAuthProps {
  children: ReactNode;
}

// Optimistic like the rest of the app's auth UI: renders immediately if a token exists,
// validates /users/me in the background (skipped if already cached this session) and only
// bounces to /login if that check actually fails.
export function RequireAuth({ children }: RequireAuthProps) {
  const hasToken = !!localStorage.getItem('access_token');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!hasToken || readUserSession()) return;
    api.auth.me().catch(() => setInvalid(true));
  }, [hasToken]);

  if (!hasToken || invalid) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
