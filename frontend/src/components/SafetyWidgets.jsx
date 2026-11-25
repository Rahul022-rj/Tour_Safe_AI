// Tourist safety tools: check-in timer and planned-journey monitoring
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSocketEvent } from '../SocketContext';
import { useNow } from '../hooks';
import { Badge, Card, ErrorBox, Spinner, useAsync, useLoad, useToast } from './ui';
import { formatDistance, formatDateTime } from '../utils';

const PRESETS = [15, 30, 60, 120];

function countdown(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function CheckInCard() {
  const toast = useToast();
  const now = useNow(1000);
  const { data, error, loading, reload } = useLoad(() => api('/safety/checkin'), []);
  const [minutes, setMinutes] = useState(30);
  const [note, setNote] = useState('');
  const action = useAsync();
  useSocketEvent('alert', (a) => a.kind === 'CHECKIN_MISSED' && reload());

  const c = data?.checkIn;
  const active = c?.status === 'active';
  const missedRecently = c?.status === 'missed' && now - new Date(c.missedAt) < 24 * 3600e3;
  const remaining = active ? new Date(c.dueAt) - now : 0;

  async function run(fn, msg) {
    try {
      await action.run(fn);
      if (msg) toast(msg, { tone: 'success' });
      reload();
    } catch {
      /* shown */
    }
  }

  return (
    <Card title="Safety check-in" actions={active ? <Badge tone={remaining < 5 * 60000 ? 'warning' : 'info'}>active</Badge> : missedRecently ? <Badge tone="danger">missed</Badge> : null}>
      {loading && !data ? <Spinner /> : (
        <>
          {active && (
            <div className="checkin-active">
              <div className="countdown" aria-live="polite">{remaining > 0 ? countdown(remaining) : 'due now'}</div>
              <p className="small">Confirm before {formatDateTime(c.dueAt)}{c.note ? ` · ${c.note}` : ''}</p>
              <div className="row">
                <button className="btn btn-success btn-lg" onClick={() => run(() => api('/safety/checkin/safe', { method: 'POST' }), 'Thanks: check-in confirmed')} disabled={action.busy}>I'm safe</button>
                <button className="btn btn-ghost" onClick={() => run(() => api('/safety/checkin', { method: 'DELETE' }), 'Check-in cancelled')} disabled={action.busy}>Cancel timer</button>
              </div>
            </div>
          )}
          {missedRecently && (
            <div className="notice notice-danger">
              You missed your check-in at {formatDateTime(c.dueAt)}. The control room and your emergency contact were alerted.
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn btn-success" onClick={() => run(() => api('/safety/checkin/safe', { method: 'POST' }), 'The control room has been told you are safe')} disabled={action.busy}>I'm safe now</button>
                <Link className="btn btn-sos" to="/tourist/sos">SOS</Link>
              </div>
            </div>
          )}
          {!active && (
            <form onSubmit={(e) => { e.preventDefault(); run(() => api('/safety/checkin', { method: 'POST', body: { minutes, note } }), `Check-in timer started: ${minutes} min`); }}>
              <p className="small muted">Going somewhere alone? Start a timer. If you do not tap "I'm safe" in time, the control room is alerted and your emergency contact is notified.</p>
              <div className="chips" role="group" aria-label="Timer length">
                {PRESETS.map((m) => <button type="button" key={m} className={`chip ${minutes === m ? 'active' : ''}`} onClick={() => setMinutes(m)}>{m < 60 ? `${m} min` : `${m / 60} h`}</button>)}
                <label className="small">Custom <input type="number" min={5} max={720} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ width: 80 }} aria-label="Custom minutes" /> min</label>
              </div>
              <input placeholder="Where are you going? (optional)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} style={{ width: '100%', margin: '8px 0' }} aria-label="Check-in note" />
              <button className="btn btn-primary" disabled={action.busy || !(minutes >= 5 && minutes <= 720)}>Start check-in timer</button>
            </form>
          )}
          <ErrorBox error={error || action.error} />
        </>
      )}
    </Card>
  );
}

export function JourneyCard({ compact = false }) {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useLoad(() => api('/safety/journey'), []);
  const action = useAsync();
  useSocketEvent('journey:self', (j) => setData((d) => ({ ...d, journey: { ...(d?.journey || {}), ...j } })));
  useSocketEvent('alert', (a) => a.kind === 'JOURNEY' && reload());
  const j = data?.journey;

  async function end(arrived) {
    try {
      await action.run(() => api('/safety/journey/end', { method: 'POST', body: { arrived } }));
      toast(arrived ? 'Journey completed' : 'Journey monitoring stopped', { tone: 'success' });
      reload();
    } catch {
      /* shown */
    }
  }

  return (
    <Card title="Journey monitoring" actions={j && <Badge tone={j.status === 'overdue' ? 'danger' : j.offRouteStreak >= 3 ? 'warning' : 'success'}>{j.status === 'overdue' ? 'overdue' : j.offRouteStreak >= 3 ? 'off route' : 'on route'}</Badge>}>
      {loading && !data ? <Spinner /> : !j ? (
        <p className="small muted">
          Plan a route in <Link to="/tourist/map">Live map &amp; routes</Link> → Safe route, then press <b>Start journey</b>. The control room is told if you leave the route or do not arrive on time.
          {compact ? '' : ' Location sharing must be on.'}
        </p>
      ) : (
        <>
          <dl className="kv">
            <dt>Destination</dt><dd>{j.destinationName || 'Selected point'}</dd>
            <dt>Started</dt><dd>{formatDateTime(j.startedAt)}</dd>
            {j.expectedArrivalAt && <><dt>Expected arrival</dt><dd>{formatDateTime(j.expectedArrivalAt)}</dd></>}
            {j.toDestinationM != null && <><dt>Distance left</dt><dd>{formatDistance(j.toDestinationM)}</dd></>}
            {j.lastDistanceFromRouteM != null && <><dt>From route</dt><dd>{formatDistance(j.lastDistanceFromRouteM)}</dd></>}
          </dl>
          {j.status === 'overdue' && <p className="notice notice-danger small">You are later than expected. The control room was informed.</p>}
          <div className="row">
            <button className="btn btn-success btn-small" onClick={() => end(true)} disabled={action.busy}>I have arrived</button>
            <button className="btn btn-ghost btn-small" onClick={() => end(false)} disabled={action.busy}>Stop monitoring</button>
          </div>
        </>
      )}
      <ErrorBox error={error || action.error} />
    </Card>
  );
}
