// Reports & logs: summary for a date range, CSV exports, operator activity (audit) log, notification history
import { useState } from 'react';
import { api, download, qs } from '../../api';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Spinner, StatCard, useLoad, useToast } from '../../components/ui';
import { ZONE_INFO, formatDateTime } from '../../utils';

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const DELIVERY_TONE = { sent: 'success', failed: 'danger', not_configured: 'muted', skipped: 'muted' };

function Bars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="bars" role="img" aria-label="Incidents per day">
      {rows.map((r) => (
        <div key={r.day} className="bar" title={`${r.day}: ${r.count}`}>
          <div className="bar-fill" style={{ height: `${(r.count / max) * 100}%` }} />
          <span className="bar-label">{r.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Reports() {
  const toast = useToast();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(daysAgo(0));
  const [tab, setTab] = useState('summary');
  const [action, setAction] = useState('');
  const [auditPage, setAuditPage] = useState(1);
  const [nStatus, setNStatus] = useState('');
  const summary = useLoad(() => api(`/admin/reports/summary${qs({ from, to })}`), [from, to]);
  const audit = useLoad(() => (tab === 'audit' ? api(`/admin/audit${qs({ from, to, action, page: auditPage })}`) : Promise.resolve(null)), [tab, from, to, action, auditPage]);
  const notes = useLoad(() => (tab === 'notifications' ? api(`/admin/notifications${qs({ status: nStatus })}`) : Promise.resolve(null)), [tab, nStatus]);

  async function exportCsv(type) {
    try {
      await download(`/admin/reports/export${qs({ type, from, to })}`, `toursafe-${type}.csv`);
    } catch (err) {
      toast(err.message, { tone: 'danger', title: 'Export failed' });
    }
  }

  const s = summary.data;
  return (
    <div className="page">
      <PageHeader title="Reports & logs" actions={
        <span className="row">
          <label className="small">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="small">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </span>
      } />
      <div className="tabs">
        {[['summary', 'Summary'], ['audit', 'Operator activity'], ['notifications', 'Notifications']].map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'summary' && (
        <>
          <ErrorBox error={summary.error} onRetry={summary.reload} />
          {summary.loading && !s ? <Spinner /> : s && (
            <>
              <div className="stats">
                <StatCard label="Incidents" value={Object.values(s.incidents.byStatus).reduce((a, b) => a + b, 0)} hint={Object.entries(s.incidents.byType).map(([k, v]) => `${k} ${v}`).join(' · ')} />
                <StatCard label="Resolved" value={s.incidents.byStatus.Resolved || 0} tone="success" />
                <StatCard label="Avg. time to resolve" value={s.incidents.resolution ? `${s.incidents.resolution.averageMinutes} min` : '-'} hint={s.incidents.resolution && `max ${s.incidents.resolution.maxMinutes} min`} />
                <StatCard label="New tourists" value={s.newTourists} />
                <StatCard label="Zone alerts" value={s.alerts.ZONE_ENTRY || 0} tone="warning" />
                <StatCard label="Anomaly alerts" value={s.alerts.ANOMALY || 0} />
              </div>
              <div className="grid-2">
                <Card title="Incidents per day">{s.incidents.byDay.length ? <Bars rows={s.incidents.byDay} /> : <EmptyState title="No incidents in this period" />}</Card>
                <Card title="Most entered risk zones">
                  {s.topZones.length === 0 ? <EmptyState title="No zone entries" /> : (
                    <table className="table"><thead><tr><th>Zone</th><th>Type</th><th>Entries</th></tr></thead>
                      <tbody>{s.topZones.map((z) => <tr key={z.zone}><td>{z.zone}</td><td><Badge tone={ZONE_INFO[z.type]?.tone}>{ZONE_INFO[z.type]?.label}</Badge></td><td>{z.entries}</td></tr>)}</tbody>
                    </table>
                  )}
                </Card>
              </div>
            </>
          )}
          <Card title="Export (CSV)">
            <p className="muted small">Exports use the date range above. Government ID numbers and passwords are never exported.</p>
            <div className="row">
              <button className="btn btn-ghost" onClick={() => exportCsv('incidents')}>Incidents</button>
              <button className="btn btn-ghost" onClick={() => exportCsv('alerts')}>Alerts</button>
              <button className="btn btn-ghost" onClick={() => exportCsv('tourists')}>Tourists (registered in range)</button>
            </div>
          </Card>
        </>
      )}

      {tab === 'audit' && (
        <Card title="Operator activity log" actions={<input placeholder="Action, e.g. INCIDENT_ASSIGN" value={action} onChange={(e) => { setAuditPage(1); setAction(e.target.value); }} aria-label="Filter by action" />}>
          <ErrorBox error={audit.error} onRetry={audit.reload} />
          {audit.loading && !audit.data ? <Spinner /> : audit.data?.logs.length === 0 ? <EmptyState title="No log entries" /> : audit.data && (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
                  <tbody>
                    {audit.data.logs.map((l) => (
                      <tr key={l._id}>
                        <td className="small">{formatDateTime(l.createdAt)}</td>
                        <td>{l.actorId?.name || '-'} <span className="muted small">{l.actorRole}</span></td>
                        <td><code>{l.action}</code></td>
                        <td className="small">{l.targetType} {l.targetId && <span className="mono">{String(l.targetId).slice(0, 12)}</span>}</td>
                        <td className="small mono">{l.details ? JSON.stringify(l.details).slice(0, 80) : ''}</td>
                        <td className="small">{l.ip}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <button className="btn btn-ghost btn-small" disabled={auditPage <= 1} onClick={() => setAuditPage(auditPage - 1)}>Previous</button>
                <span className="small">Page {auditPage} of {Math.max(1, Math.ceil(audit.data.total / audit.data.limit))}</span>
                <button className="btn btn-ghost btn-small" disabled={auditPage * audit.data.limit >= audit.data.total} onClick={() => setAuditPage(auditPage + 1)}>Next</button>
              </div>
            </>
          )}
        </Card>
      )}

      {tab === 'notifications' && (
        <Card title="Email & SMS history" actions={
          <select value={nStatus} onChange={(e) => setNStatus(e.target.value)} aria-label="Status"><option value="">All</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="not_configured">Not configured</option><option value="skipped">Skipped</option></select>
        }>
          <ErrorBox error={notes.error} onRetry={notes.reload} />
          {notes.loading && !notes.data ? <Spinner /> : notes.data?.notifications.length === 0 ? <EmptyState title="No notifications" /> : notes.data && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Event</th><th>Tourist</th><th>Channel</th><th>Recipient</th><th>Status</th><th>Detail</th></tr></thead>
                <tbody>
                  {notes.data.notifications.map((n) => (
                    <tr key={n._id}>
                      <td className="small">{formatDateTime(n.createdAt)}</td>
                      <td>{n.event}</td>
                      <td>{n.userId?.name || '-'}</td>
                      <td>{n.channel}</td>
                      <td className="small">{n.recipientType} {n.to}</td>
                      <td><Badge tone={DELIVERY_TONE[n.status]}>{n.status}</Badge></td>
                      <td className="small">{n.error || n.providerMessageId || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
