// Operator safety centre: send advisories (all tourists or one zone), watch check-in timers and journeys
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useSocketEvent } from '../../SocketContext';
import { useNow, useZones } from '../../hooks';
import { Badge, Card, EmptyState, ErrorBox, Field, PageHeader, Spinner, useAsync, useConfirm, useLoad, useToast } from '../../components/ui';
import { ZONE_INFO, formatDateTime, formatDistance, timeAgo } from '../../utils';

const SEV_TONE = { info: 'info', warning: 'warning', critical: 'danger' };

function Compose({ onSent }) {
  const { zones } = useZones();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState({ title: '', message: '', severity: 'info', target: 'all', zoneId: '' });
  const { busy, error, run } = useAsync();
  const set = (e) => setF({ ...f, [e.target.name]: e.target.value });
  const zone = zones.find((z) => z._id === f.zoneId);

  async function send(e) {
    e.preventDefault();
    const who = f.target === 'all' ? 'ALL active tourists' : `tourists currently inside "${zone?.name}"`;
    if (!(await confirm({ title: 'Send this advisory?', message: `It will be delivered immediately to ${who}.`, confirmText: 'Send', tone: f.severity === 'critical' ? 'danger' : 'primary' }))) return;
    try {
      const { broadcast } = await run(() => api('/safety/broadcasts', { method: 'POST', body: f }));
      toast(`Advisory delivered to ${broadcast.recipients} tourist(s)`, { tone: 'success' });
      setF({ ...f, title: '', message: '' });
      onSent();
    } catch {
      /* shown */
    }
  }

  return (
    <Card title="Send a safety advisory">
      <form onSubmit={send}>
        <Field label="Title"><input name="title" value={f.title} onChange={set} maxLength={120} placeholder="e.g. Heavy crowd near Charminar" /></Field>
        <Field label="Message"><textarea name="message" rows={3} value={f.message} onChange={set} maxLength={1000} placeholder="What should tourists know or do?" /></Field>
        <div className="grid-2">
          <Field label="Severity">
            <select name="severity" value={f.severity} onChange={set}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select>
          </Field>
          <Field label="Send to">
            <select name="target" value={f.target} onChange={set}><option value="all">All active tourists</option><option value="zone">Tourists inside a zone</option></select>
          </Field>
        </div>
        {f.target === 'zone' && (
          <Field label="Zone">
            <select name="zoneId" value={f.zoneId} onChange={set}>
              <option value="">Choose a zone…</option>
              {zones.map((z) => <option key={z._id} value={z._id}>{z.name} ({ZONE_INFO[z.type].label})</option>)}
            </select>
          </Field>
        )}
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy || f.title.trim().length < 3 || f.message.trim().length < 3 || (f.target === 'zone' && !f.zoneId)}>{busy ? 'Sending…' : 'Send advisory'}</button>
        <p className="muted small">Delivered in the app (pop-up + notifications page). Zone advisories reach tourists whose last location in the past hour is inside the zone.</p>
      </form>
    </Card>
  );
}

export default function SafetyCenter() {
  const now = useNow(5000);
  const overview = useLoad(() => api('/safety/overview'), []);
  const history = useLoad(() => api('/safety/broadcasts'), []);
  useSocketEvent('checkin:update', () => overview.reload());
  useSocketEvent('journey:update', () => overview.reload());
  useSocketEvent('broadcast', () => history.reload());
  const o = overview.data;

  return (
    <div className="page">
      <PageHeader title="Safety centre" subtitle="Advisories, safety check-ins and journeys being monitored" />
      <div className="grid-main">
        <div className="stack">
          <Card title={`Check-in timers (${o?.checkIns.length ?? '–'})`}>
            <ErrorBox error={overview.error} onRetry={overview.reload} />
            {overview.loading && !o ? <Spinner /> : o.checkIns.length === 0 ? <EmptyState title="No active or missed check-ins" /> : (
              <table className="table">
                <thead><tr><th>Tourist</th><th>Status</th><th>Due</th><th>Note</th><th>Contact</th></tr></thead>
                <tbody>
                  {o.checkIns.map((c) => (
                    <tr key={c._id}>
                      <td><Link to={`/operator/tourists/${c.touristId?._id}`}>{c.touristId?.name}</Link></td>
                      <td><Badge tone={c.status === 'missed' ? 'danger' : 'info'}>{c.status}</Badge></td>
                      <td className="small">{formatDateTime(c.dueAt)}{c.status === 'active' && ` (${Math.max(0, Math.round((new Date(c.dueAt) - now) / 60000))} min left)`}</td>
                      <td className="small">{c.note || '-'}</td>
                      <td className="small">{c.touristId?.phone && <a href={`tel:${c.touristId.phone}`}>{c.touristId.phone}</a>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title={`Journeys (${o?.journeys.length ?? '–'})`}>
            {overview.loading && !o ? <Spinner /> : o?.journeys.length === 0 ? <EmptyState title="No journeys being monitored" /> : o && (
              <table className="table">
                <thead><tr><th>Tourist</th><th>Destination</th><th>Status</th><th>From route</th><th>Expected</th></tr></thead>
                <tbody>
                  {o.journeys.map((j) => (
                    <tr key={j._id}>
                      <td><Link to={`/operator/tourists/${j.touristId?._id}`}>{j.touristId?.name}</Link></td>
                      <td className="small">{j.destinationName || '-'} · {formatDistance(j.distanceM)}</td>
                      <td><Badge tone={j.status === 'overdue' ? 'danger' : j.offRouteStreak >= 3 ? 'warning' : 'success'}>{j.status === 'overdue' ? 'overdue' : j.offRouteStreak >= 3 ? 'off route' : 'on route'}</Badge></td>
                      <td className="small">{j.lastDistanceFromRouteM != null ? formatDistance(j.lastDistanceFromRouteM) : '-'}</td>
                      <td className="small">{j.expectedArrivalAt ? formatDateTime(j.expectedArrivalAt) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div className="stack">
          <Compose onSent={history.reload} />
          <Card title="Sent advisories">
            {history.loading && !history.data ? <Spinner /> : history.data?.broadcasts.length === 0 ? <EmptyState title="Nothing sent yet" /> : history.data?.broadcasts.map((b) => (
              <div key={b._id} className="list-row">
                <Badge tone={SEV_TONE[b.severity]}>{b.severity}</Badge>
                <span className="grow"><b>{b.title}</b> <span className="muted small">· {b.target === 'zone' ? b.zoneName : 'all'} · {b.recipients} recipient(s) · {timeAgo(b.createdAt, now)} · {b.createdBy?.name}</span><br /><span className="small">{b.message}</span></span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
