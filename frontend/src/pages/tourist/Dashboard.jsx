// Tourist home: safety status, tracking, SOS shortcut, Digital ID status, open incidents, latest notifications
import { Link } from 'react-router-dom';
import { useAuth } from '../../AuthContext';
import { api } from '../../api';
import { useIncidents, useZones } from '../../hooks';
import { useSocketEvent } from '../../SocketContext';
import { useTracking } from '../../tracking/TrackingContext';
import { TrackingCard, ZoneStatusCard } from '../../components/TouristWidgets';
import { CheckInCard, JourneyCard } from '../../components/SafetyWidgets';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Spinner, useLoad } from '../../components/ui';
import { CHAIN_INFO, STATUS_INFO, formatDate, timeAgo } from '../../utils';

function RiskCard() {
  const t = useTracking();
  const pos = t.position;
  const key = pos ? `${pos[0].toFixed(3)},${pos[1].toFixed(3)}` : '';
  const { data, error, loading } = useLoad(() => (pos ? api(`/geo/risk?lat=${pos[0]}&lng=${pos[1]}`) : Promise.resolve(null)), [key]);
  return (
    <Card title="Area risk indication" actions={<Badge tone="warning">experimental</Badge>}>
      {!pos ? <p className="muted small">Available once your location is known.</p> : loading ? <Spinner /> : error ? <ErrorBox error={error} /> : data && (
        <>
          <p>
            {data.modelAvailable ? <>Model v{data.modelVersion}: <b>{data.level}</b> ({Math.round(data.score * 100)}%)</> : <>Indicative score <b>{Math.round(data.score * 100)}%</b> (rule-based)</>}
          </p>
          <p className="muted small">{data.message || data.confidence?.note}</p>
          <details className="small"><summary>Limitations</summary><ul>{data.limitations.map((l) => <li key={l}>{l}</li>)}</ul></details>
        </>
      )}
    </Card>
  );
}

export default function TouristDashboard() {
  const { user } = useAuth();
  const { zones } = useZones();
  const { incidents, loading } = useIncidents();
  const notes = useLoad(() => api('/tourists/me/notifications?limit=5'), []);
  useSocketEvent('alert', () => notes.reload());
  const open = incidents.filter((i) => i.status !== 'Resolved');
  const tripActive = new Date(user.tripStart) <= new Date() && new Date(user.tripEnd) >= new Date();

  return (
    <div className="page">
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle={`Trip ${formatDate(user.tripStart)} – ${formatDate(user.tripEnd)}${tripActive ? '' : ' (not active today)'}`} />
      <div className="grid-dash">
        <ZoneStatusCard zones={zones} />
        <Card title="Emergency" className="sos-card-mini">
          <p className="small">Press SOS to alert the control room with your location.</p>
          <Link to="/tourist/sos" className="btn btn-sos btn-block">SOS</Link>
          <p className="muted small">Emergency contact: {user.emergencyContact?.name} ({user.emergencyContact?.phone})</p>
        </Card>
        <TrackingCard compact />
        <CheckInCard />
        <JourneyCard compact />
        <Card title="Digital ID" actions={<Link to="/tourist/id" className="small">Open</Link>}>
          <p>{user.idRevokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone={CHAIN_INFO[user.idChainStatus]?.tone}>{CHAIN_INFO[user.idChainStatus]?.label || user.idChainStatus}</Badge>}</p>
          <p className="muted small">Show the QR code to an officer to verify your identity.</p>
        </Card>
        <Card title="Open incidents" actions={<Link to="/tourist/incidents" className="small">All</Link>}>
          {loading ? <Spinner /> : open.length === 0 ? <EmptyState title="No open incidents" /> : open.map((i) => (
            <div key={i._id} className="list-row">
              <Badge tone={STATUS_INFO[i.status].tone}>{i.status}</Badge>
              <span>{i.type} · {timeAgo(i.createdAt)}{i.assignedTo && <> · handled by {i.assignedTo}</>}</span>
            </div>
          ))}
        </Card>
        <Card title="Latest notifications" actions={<Link to="/tourist/notifications" className="small">All</Link>}>
          {notes.loading && !notes.data ? <Spinner /> : notes.error ? <ErrorBox error={notes.error} onRetry={notes.reload} /> : notes.data.alerts.length === 0 ? <EmptyState title="Nothing yet" /> : notes.data.alerts.map((a) => (
            <div key={a.id} className="list-row">
              <span className={`sev sev-${a.severity}`} aria-hidden="true" />
              <span><b>{a.title}</b> <span className="muted small">{timeAgo(a.timestamp)}</span><br /><span className="small">{a.touristMessage || a.message}</span></span>
            </div>
          ))}
        </Card>
        <RiskCard />
      </div>
    </div>
  );
}
