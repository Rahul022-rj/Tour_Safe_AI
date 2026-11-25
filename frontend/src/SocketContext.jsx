// One Socket.IO connection for the whole app while a user is logged in.
// Components subscribe to events with useSocketEvent('event', handler); each hook adds exactly one listener
// and removes it on unmount, so reconnects never create duplicate handlers.
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { getToken } from './api';

const SocketContext = createContext({ socket: null, status: 'offline' });

export function SocketProvider({ children }) {
  const { user, endSession } = useAuth();
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('offline'); // live | connecting | reconnecting | offline
  const userId = user?._id;

  // Connect after login, disconnect on logout
  useEffect(() => {
    if (!userId) return undefined;
    // No URL = same origin; the Vite dev proxy (or the production server) forwards /socket.io to the backend.
    // auth is a function so every reconnect sends the CURRENT token (e.g. after a password change).
    const s = io({ auth: (cb) => cb({ token: getToken() }), reconnectionDelayMax: 10000 });
    setStatus('connecting');
    s.on('connect', () => setStatus('live'));
    s.on('disconnect', (reason) => setStatus(reason === 'io client disconnect' ? 'offline' : 'reconnecting'));
    s.io.on('reconnect_attempt', () => setStatus('reconnecting'));
    s.on('connect_error', (err) => {
      // The server refused our token: the session is over
      if (/token|session|suspended|unauthorized/i.test(err.message)) {
        s.disconnect();
        window.dispatchEvent(new Event('auth:logout'));
        endSession(err.message);
      } else setStatus('reconnecting');
    });
    s.on('session:revoked', ({ reason } = {}) => {
      window.dispatchEvent(new Event('auth:logout'));
      endSession(`${reason || 'Session ended'}. Please log in again.`);
    });
    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
      setStatus('offline');
    };
  }, [userId, endSession]);

  return <SocketContext.Provider value={{ socket, status }}>{children}</SocketContext.Provider>;
}

export const useSocketStatus = () => useContext(SocketContext).status;
export const useSocket = () => useContext(SocketContext).socket;

// Calls handler(data) every time the server emits this event
export function useSocketEvent(event, handler) {
  const { socket } = useContext(SocketContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler; // always call the latest handler without re-subscribing

  useEffect(() => {
    if (!socket) return undefined;
    const listener = (data) => handlerRef.current(data);
    socket.on(event, listener);
    return () => socket.off(event, listener);
  }, [socket, event]);
}

// Calls handler() after every RE-connect (not the first connect), so pages can reload missed data
export function useSocketReconnect(handler) {
  const { socket } = useContext(SocketContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!socket) return undefined;
    let first = true;
    const onConnect = () => {
      if (first) first = false;
      else handlerRef.current();
    };
    if (socket.connected) first = false;
    socket.on('connect', onConnect);
    return () => socket.off('connect', onConnect);
  }, [socket]);
}
