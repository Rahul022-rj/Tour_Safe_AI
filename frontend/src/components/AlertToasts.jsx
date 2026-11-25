// Turns every "alert" pushed by the server into a toast. Operators receive every alert;
// a tourist receives only alerts about themselves (the server decides via Socket.IO rooms).
import { useRef } from 'react';
import { useAuth } from '../AuthContext';
import { useSocketEvent } from '../SocketContext';
import { useToast } from './ui';

const TONE = { critical: 'danger', high: 'danger', medium: 'warning', review: 'warning', info: 'info' };
const DURATION = { critical: 0, high: 12000, medium: 8000, review: 10000, info: 6000 }; // SOS stays until dismissed

export default function AlertToasts() {
  const { user } = useAuth();
  const toast = useToast();
  const seen = useRef(new Set()); // never show the same alert twice (e.g. after a reconnect)

  useSocketEvent('alert', (alert) => {
    if (seen.current.has(alert.id)) return;
    seen.current.add(alert.id);
    const message = user?.role === 'tourist' ? alert.touristMessage || alert.message : alert.message;
    toast(message, { title: alert.title, tone: TONE[alert.severity] || 'info', duration: DURATION[alert.severity] ?? 8000 });
    if (alert.severity === 'critical' && user?.role === 'admin') {
      try {
        // Short beep so an SOS is noticed even when the operator is looking elsewhere
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.frequency.value = 880;
        osc.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      } catch {
        /* audio not available */
      }
    }
  });
  return null;
}
