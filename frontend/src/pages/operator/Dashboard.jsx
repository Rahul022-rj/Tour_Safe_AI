// Operator dashboard: every number comes from GET /api/admin/stats (database), plus the live map and alert feed
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useSocketEvent } from '../../SocketContext';
import { AlertFeed, LiveMap, useAlerts, useLiveTourists } from '../../components/OperatorLive';
import { Badge, Card, ErrorBox, PageHeader, StatCard, useLoad } from '../../components/ui';
import { STATUS_INFO, timeAgo } from '../../utils';

export default function OperatorDashboard() {
  const stats = useLoad(() => api('/admin/stats'), []);
  const { tourists, openIncidents } = useLiveTourists();
  const { alerts } = useAlerts();
  // Counters change with incidents and zone alerts: refresh them (debounced by the browser's event loop)
  useSocketEvent('incident', () => stats.reload());
  useSocketEvent('alert', () => stats.reload());
  const s = stats.data;

  return (
    <div className="page">
      <PageHeader title="Control room" subtitle={s ? `Updated ${timeAgo(s.generatedAt)}` : 'Loading…'} actions={<button className="btn btn-ghost btn-small" onClick={stats.reload}>Refresh</button>} />
      <ErrorBox error={stats.error} onRetry={stats.reload} />
      <div className="stats">
        <StatCard label="Registered tourists" value={s?.tourists.total} hint={s && `${s.tourists.activeTrips} on an active trip`} />
        <StatCard label="Currently tracked" value={s?.tourists.tracked} hint={s && `${s.tourists.online} connected now`} tone="info" />
        <StatCard label="In caution zones" value={s?.tourists.inCaution} tone="warning" />
        <StatCard label="In restricted zones" value={s?.tourists.inRestricted} tone="danger" />
        <StatCard label="Open incidents" value={s?.incidents.open} hint={s && `${s.incidents.reported} reported · ${s.incidents.assigned} assigned`} tone={s?.incidents.reported ? 'danger' : 'default'} />
        <StatCard label="Resolved incidents" value={s?.incidents.resolved} tone="success" />
        <StatCard label="Alerts (24 h)" value={s?.alerts.last24h} hint={s && `${s.alerts.unreviewedAnomalies} anomalies to review`} />
        <StatCard label="Check-in timers" value={s?.safety?.activeCheckIns} hint={s?.safety && `${s.safety.missedCheckIns} missed (24 h)`} tone={s?.safety?.missedCheckIns ? 'danger' : 'default'} />
        <StatCard label="Journeys monitored" value={s?.safety?.activeJourneys} hint={s?.safety && `${s.safety.overdueJourneys} overdue`} tone={s?.safety?.overdueJourneys ? 'warning' : 'default'} />
        <StatCard label="Blockchain" value={s ? (s.blockchain.ok ? 'Online' : 'Offline') : null} hint={s?.blockchain.ok ? `chain ${s.blockchain.chainId}, block ${s.blockchain.blockNumber}` : s?.blockchain.error} tone={s?.blockchain.ok ? 'success' : 'danger'} />
      </div>
      <div className="grid-main">
        <Card title="Live map" actions={<Link to="/operator/monitor" className="small">Full screen monitor →</Link>}>
          <LiveMap tourists={tourists} openIncidents={openIncidents} height={420} />
        </Card>
        <div className="stack">
          <Card title={`Open incidents (${openIncidents.length})`} actions={<Link to="/operator/incidents" className="small">Manage →</Link>}>
            {openIncidents.length === 0 ? <p className="muted small">No open incidents.</p> : openIncidents.slice(0, 6).map((i) => (
              <Link key={i._id} to={`/operator/incidents?id=${i._id}`} className="list-row link-row">
                <Badge tone={STATUS_INFO[i.status].tone}>{i.status}</Badge>
                <span>{i.type}: {i.touristId?.name} · {timeAgo(i.createdAt)}</span>
              </Link>
            ))}
          </Card>
          <Card title="Recent alerts">
            <AlertFeed alerts={alerts} compact />
          </Card>
        </div>
      </div>
    </div>
  );
}
