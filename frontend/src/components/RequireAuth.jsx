import React, { createContext, useContext, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, getToken, getStoredUser, setSession, clearSession } from '../api';
import { isOfflineError } from '../lib/network';

const homeFor = (role) => (role === 'admin' ? '/admin' : '/dashboard');

// 'ok' = confirmed by the server; 'offline' = server unreachable, showing the stored user until reconnect.
const SessionStatusContext = createContext('ok');
export const useSessionStatus = () => useContext(SessionStatusContext);

// Confirms the session with the server before rendering a protected page, so access
// never depends on browser-editable data alone. Offline, the stored user is used read-only
// (no data changes are possible and Admin pages cache nothing); the check reruns on reconnect.
const RequireAuth = ({ role, children }) => {
  const [state, setState] = useState({ status: 'checking', user: null });

  useEffect(() => {
    let cancelled = false;
    if (!getToken()) {
      setState({ status: 'denied', user: null });
      return undefined;
    }
    const check = () =>
      api
        .get('/api/me')
        .then((res) => {
          if (cancelled) return;
          setSession({ user: res.data.user });
          setState({ status: 'ok', user: res.data.user });
        })
        .catch((err) => {
          if (cancelled) return;
          // A 401 is handled by the api interceptor (it redirects to /login).
          if (err.response?.status === 401) {
            setState({ status: 'denied', user: null });
            return;
          }
          const stored = getStoredUser();
          if (isOfflineError(err) && stored) {
            setState({ status: 'offline', user: stored });
            return;
          }
          clearSession();
          setState({ status: 'denied', user: null });
        });

    check();
    window.addEventListener('online', check);
    return () => {
      cancelled = true;
      window.removeEventListener('online', check);
    };
  }, []);

  if (state.status === 'checking') return null;
  if (state.status === 'denied') return <Navigate to="/login" replace />;
  if (role && state.user.role !== role) return <Navigate to={homeFor(state.user.role)} replace />;
  return <SessionStatusContext.Provider value={state.status}>{children}</SessionStatusContext.Provider>;
};

export default RequireAuth;
