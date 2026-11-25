// Keeps the logged-in user in one place so every page can read it with useAuth().
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, getToken, setToken } from './api';

const AuthContext = createContext(null);

// Where each role lands after login
export const homeFor = (user) => (user?.role === 'admin' ? '/operator' : '/tourist');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(''); // e.g. "Session expired" shown on the login page
  const checkingRef = useRef(true); // true while the start-up session check runs (a stale token is not news)

  // On page load/refresh: if a token is saved, ask the backend who it belongs to
  useEffect(() => {
    if (!getToken()) {
      checkingRef.current = false;
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Only a 401 means the token is bad. A restarting or unreachable server must not log the user out,
    // so other errors are retried with backoff and the token is kept.
    (async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          const data = await api('/auth/me');
          if (!cancelled) setUser(data.user);
          break;
        } catch (err) {
          if (err.status === 401 || err.status === 403 || err.status === 404) {
            setToken(null);
            break;
          }
          if (attempt === 4) setNotice('Cannot reach the server right now. Your session is kept; try again in a moment.');
          else await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
      if (!cancelled) {
        checkingRef.current = false;
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Called after a successful login or register
  const saveSession = useCallback(({ token, user: u }) => {
    setToken(token);
    setNotice('');
    setUser(u);
  }, []);

  const endSession = useCallback((message = '') => {
    setToken(null);
    setUser(null);
    setNotice(message);
  }, []);

  // Tell the server (stops tracking, writes the audit log), then forget the token either way
  const logout = useCallback(async ({ everywhere = false } = {}) => {
    window.dispatchEvent(new Event('auth:logout')); // stops location tracking immediately
    try {
      await api('/auth/logout', { method: 'POST', body: { everywhere } });
    } catch {
      /* the token is removed locally anyway */
    }
    endSession('');
  }, [endSession]);

  // Any request answering 401 -> the session is over
  useEffect(() => {
    const onExpired = (e) => {
      window.dispatchEvent(new Event('auth:logout'));
      endSession(checkingRef.current ? '' : e.detail || 'Your session has expired. Please log in again.');
    };
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [endSession]);

  const refreshUser = useCallback(async () => {
    const data = await api('/auth/me');
    setUser(data.user);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, notice, saveSession, logout, endSession, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
