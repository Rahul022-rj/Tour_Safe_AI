// Tourist location tracking shared by every tourist page (map, dashboard, SOS) and stopped on logout.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useSocketEvent } from '../SocketContext';
import { createTracker, STATE_TEXT } from './tracker';
import { toLatLng } from '../utils';

const TrackingContext = createContext(null);

export function TrackingProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'idle', position: null, accuracy: null, fixAt: null, sentAt: null, sendError: '', zone: null });
  // Last position known to the server (from this tab or another device of the same tourist)
  const [serverFix, setServerFix] = useState(() =>
    user?.lastLocation ? { position: toLatLng(user.lastLocation), at: user.lastSeenAt, accuracy: user.lastAccuracy, source: user.lastSource, zone: { id: user.lastZoneId, type: user.lastZoneType } } : null
  );
  const [permission, setPermission] = useState('unknown');
  const trackerRef = useRef(null);

  if (!trackerRef.current) {
    trackerRef.current = createTracker({
      geolocation: typeof navigator !== 'undefined' ? navigator.geolocation : undefined,
      isSecure: typeof window === 'undefined' || window.isSecureContext !== false,
      send: (body) => api('/tourists/location', { method: 'POST', body }),
      onChange: setState,
    });
  }

  // Show the browser's permission state up front where the Permissions API exists
  useEffect(() => {
    let status;
    navigator.permissions?.query({ name: 'geolocation' }).then((s) => {
      status = s;
      setPermission(s.state);
      s.onchange = () => setPermission(s.state);
    }).catch(() => {});
    return () => {
      if (status) status.onchange = null;
    };
  }, []);

  const start = useCallback(async () => {
    const started = trackerRef.current.start();
    if (started) await api('/tourists/tracking', { method: 'POST', body: { active: true } }).catch(() => {});
  }, []);

  const stop = useCallback(async () => {
    trackerRef.current.stop();
    await api('/tourists/tracking', { method: 'POST', body: { active: false } }).catch(() => {});
  }, []);

  // Resume after a page reload: if the tourist was sharing and the browser already granted permission,
  // start again without asking (no prompt can appear because permission is already 'granted').
  const resumeChecked = useRef(false);
  useEffect(() => {
    if (resumeChecked.current || permission === 'unknown') return;
    resumeChecked.current = true;
    if (user?.trackingActive && permission === 'granted' && !trackerRef.current.isRunning()) trackerRef.current.start();
  }, [permission, user?.trackingActive]);

  // Logout (or session expiry) stops the browser watch at once; the server marks tracking off itself
  useEffect(() => {
    const onLogout = () => trackerRef.current.stop();
    window.addEventListener('auth:logout', onLogout);
    return () => {
      window.removeEventListener('auth:logout', onLogout);
      trackerRef.current.stop();
    };
  }, []);

  useSocketEvent('location:self', (u) => {
    setServerFix({ position: [u.lat, u.lng], at: u.timestamp, accuracy: u.accuracy, source: u.source, zone: { id: u.zoneId, type: u.zoneType, name: u.zoneName, confidence: u.zoneConfidence } });
  });

  // The position to show: this device's live fix if tracking, otherwise the last one the server knows
  const position = state.position || serverFix?.position || null;
  const value = {
    ...state,
    statusText: STATE_TEXT[state.status],
    permission,
    serverFix,
    position,
    zone: serverFix?.zone || state.zone,
    isTracking: trackerRef.current.isRunning(),
    start,
    stop,
  };
  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>;
}

export const useTracking = () => useContext(TrackingContext);
