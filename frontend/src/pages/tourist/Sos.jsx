// Emergency SOS: large button -> confirmation step -> incident. Shows coordinates, address when available,
// emergency contact, and the live status of the open SOS (with cancel while it is still "Reported").
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { useIncidents, useNow } from '../../hooks';
import { useTracking } from '../../tracking/TrackingContext';
import { Badge, Card, ErrorBox, PageHeader, useAsync, useConfirm, useToast } from '../../components/ui';
import { STATUS_INFO, formatDateTime, timeAgo } from '../../utils';

// ---------------- Offline SOS queue ----------------
// If the SOS cannot reach the server (no network), it is stored on the device and sent automatically as soon
// as the connection is back. Queued SOS older than 30 minutes are discarded (the situation has changed).
const PENDING_KEY = 'pendingSos';
const PENDING_MAX_AGE_MS = 30 * 60000;
export const readPendingSos = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    return p && Date.now() - p.queuedAt < PENDING_MAX_AGE_MS ? p : null;
  } catch {
    return null;
  }
};

// Mounted once in the tourist layout: retries a queued SOS on start, when the browser comes online, and every 15 s
export function PendingSosSender() {
  const toast = useToast();
  const sending = useRef(false);
  useEffect(() => {
    async function flush() {
      const p = readPendingSos();
      if (!p) {
        localStorage.removeItem(PENDING_KEY);
        return;
      }
      if (sending.current) return;
      sending.current = true;
      try {
        const note = `(queued offline at ${new Date(p.queuedAt).toLocaleTimeString()})`;
        const body = { ...p.body, message: `${p.body.message || ''} ${note}`.trim() };
        const data = await api('/incidents/sos', { method: 'POST', body });
        localStorage.removeItem(PENDING_KEY);
        window.dispatchEvent(new Event('sos:queue'));
        toast(data.duplicate ? data.message : 'Your queued SOS has now been delivered to the control room.', { tone: 'success', title: 'SOS sent' });
      } catch (err) {
        if (err.code !== 'NETWORK') {
          localStorage.removeItem(PENDING_KEY); // the server answered: do not retry forever
          window.dispatchEvent(new Event('sos:queue'));
          toast(err.message, { tone: 'danger', title: 'Queued SOS failed' });
        }
      } finally {
        sending.current = false;
      }
    }
    flush();
    window.addEventListener('online', flush);
    const id = setInterval(flush, 15000);
    return () => {
      window.removeEventListener('online', flush);
      clearInterval(id);
    };
  }, [toast]);
  return null;
}

export default function SosPage() {
  const { user } = useAuth();
  const t = useTracking();
  const { incidents } = useIncidents();
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow(1000);
  const [message, setMessage] = useState('');
  const [address, setAddress] = useState(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [stage, setStage] = useState('idle'); // idle | confirm
  const { busy, error, run, setError } = useAsync();
  const [queued, setQueued] = useState(() => readPendingSos());
  useEffect(() => {
    const update = () => setQueued(readPendingSos());
    window.addEventListener('sos:queue', update);
    return () => window.removeEventListener('sos:queue', update);
  }, []);

  const position = t.position;
  const usingLive = t.isTracking && t.status === 'active'; // this device's live fix, not the last saved one
  const open = incidents.find((i) => i.type === 'SOS' && i.status !== 'Resolved');

  // Ask the tourist's browser for a position right away if they are not sharing yet (better SOS accuracy)
  useEffect(() => {
    if (!t.isTracking && t.status === 'idle') t.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Address of the current position, when the geocoder can be reached (never blocks the SOS)
  const key = position ? `${position[0].toFixed(4)},${position[1].toFixed(4)}` : '';
  useEffect(() => {
    if (!position) return undefined;
    const ctrl = new AbortController();
    api(`/geo/reverse?lat=${position[0]}&lng=${position[1]}`, { signal: ctrl.signal }).then((d) => setAddress(d.address)).catch(() => setAddress(null));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  async function send() {
    setStage('idle');
    try {
      const body = { message };
      if (t.position && t.status === 'active') {
        body.lat = t.position[0];
        body.lng = t.position[1];
        if (Number.isFinite(t.accuracy)) body.accuracy = t.accuracy;
      }
      const data = await run(() => api('/incidents/sos', { method: 'POST', body }));
      if (data.duplicate) {
        toast(data.message, { tone: 'warning', title: 'SOS already sent' });
        setCooldownUntil(Date.now() + data.retryAfterSeconds * 1000);
      } else {
        toast('The control room has your location. Stay where you are if it is safe.', { tone: 'success', title: 'SOS sent' });
        setCooldownUntil(Date.now() + 30000);
        setMessage('');
      }
    } catch (err) {
      // No connection: keep the SOS on this device and send it automatically when back online
      if (err.code === 'NETWORK') {
        const body = { message };
        if (t.position) Object.assign(body, { lat: t.position[0], lng: t.position[1] }, Number.isFinite(t.accuracy) ? { accuracy: t.accuracy } : {});
        const p = { body, queuedAt: Date.now() };
        localStorage.setItem(PENDING_KEY, JSON.stringify(p));
        setQueued(p);
        setError(null);
      }
      /* other errors: ErrorBox shows the real reason; nothing is claimed as sent */
    }
  }

  async function cancel() {
    const reason = await confirm({ title: 'Cancel your SOS?', message: 'Only cancel if you no longer need help. The control room is told immediately.', confirmText: 'Cancel SOS', tone: 'danger', input: { label: 'Reason', placeholder: 'e.g. False alarm, I am safe', required: true, minLength: 3 } });
    if (!reason) return;
    try {
      await api(`/incidents/${open._id}/cancel`, { method: 'POST', body: { reason } });
      toast('Your SOS was cancelled.', { tone: 'info' });
    } catch (err) {
      setError(err);
    }
  }

  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  return (
    <div className="page narrow-page">
      <PageHeader title="Emergency SOS" subtitle="Use only when you need help. In a life-threatening emergency also call 112." />
      <div className="sos-panel card">
        {stage === 'idle' ? (
          <>
            <button className="sos-button" onClick={() => setStage('confirm')} disabled={busy || secondsLeft > 0} aria-describedby="sos-help">
              {busy ? 'Sending…' : secondsLeft > 0 ? `SENT (${secondsLeft}s)` : 'SOS'}
            </button>
            <p id="sos-help" className="muted small">Press, then confirm. Repeat presses within 30 seconds are ignored.</p>
          </>
        ) : (
          <div className="sos-confirm" role="alertdialog" aria-labelledby="sos-q">
            <h2 id="sos-q">Send an SOS to the control room?</h2>
            <label className="field">
              <span>What is happening? (optional)</span>
              <textarea rows={2} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. I am lost, someone is following me" autoFocus />
            </label>
            <div className="row">
              <button className="btn btn-sos btn-lg" onClick={send} disabled={busy}>Yes, send SOS</button>
              <button className="btn btn-ghost btn-lg" onClick={() => setStage('idle')}>Cancel</button>
            </div>
          </div>
        )}
        {queued && (
          <div className="notice notice-danger" role="alert">
            <b>No connection: your SOS is NOT delivered yet.</b> It is saved on this device and will be sent automatically when the connection returns.
            <div className="row" style={{ marginTop: 8 }}>
              <a className="btn btn-sos" href="tel:112">Call 112 now</a>
            </div>
          </div>
        )}
        <ErrorBox error={error} />
        <dl className="kv">
          <dt>Location sent</dt>
          <dd>
            {position ? <>{position[0].toFixed(5)}, {position[1].toFixed(5)} {usingLive ? <Badge tone="success">live</Badge> : <Badge tone="warning">last known</Badge>}</> : <span className="text-danger">Unknown: allow location access</span>}
            {Number.isFinite(t.accuracy) && <span className="muted small"> ± {Math.round(t.accuracy)} m</span>}
          </dd>
          <dt>Address</dt>
          <dd>{address || <span className="muted">not available</span>}</dd>
          <dt>Location status</dt>
          <dd className="small">{t.statusText}</dd>
          <dt>Emergency contact</dt>
          <dd>{user.emergencyContact?.name} · <a href={`tel:${user.emergencyContact?.phone}`}>{user.emergencyContact?.phone}</a></dd>
        </dl>
      </div>

      {open && (
        <Card title="Your open SOS" actions={<Badge tone={STATUS_INFO[open.status].tone}>{open.status}</Badge>}>
          <p>Sent {formatDateTime(open.createdAt)} ({timeAgo(open.createdAt, now)}){open.assignedTo && <> · <b>{open.assignedTo}</b> is handling it</>}</p>
          {open.address && <p className="small">{open.address}</p>}
          <ul className="history">
            {open.history.map((h) => <li key={h._id}><b>{h.status}</b> · {formatDateTime(h.at)}{h.note && ` · ${h.note}`}</li>)}
          </ul>
          <div className="row">
            <Link className="btn btn-ghost btn-small" to="/tourist/incidents">All incidents</Link>
            {open.status === 'Reported' && <button className="btn btn-danger btn-small" onClick={cancel}>Cancel SOS (false alarm)</button>}
          </div>
        </Card>
      )}
    </div>
  );
}
