// Tourist safety tools: check-in timer, journey monitoring, advisories from the control room
import { api } from '../../api';
import { useSocketEvent } from '../../SocketContext';
import { CheckInCard, JourneyCard } from '../../components/SafetyWidgets';
import { TrackingCard } from '../../components/TouristWidgets';
import { Card, EmptyState, PageHeader, Spinner, useLoad } from '../../components/ui';
import { formatDateTime } from '../../utils';

function Advisories() {
  const { data, loading, reload } = useLoad(() => api('/tourists/me/notifications?limit=100'), []);
  useSocketEvent('alert', (a) => a.kind === 'BROADCAST' && reload());
  const items = (data?.alerts || []).filter((a) => a.kind === 'BROADCAST').slice(0, 10);
  return (
    <Card title="Advisories from the control room">
      {loading && !data ? <Spinner /> : items.length === 0 ? <EmptyState title="No advisories">Safety notices sent by the control room appear here.</EmptyState> : (
        <ul className="alert-list">
          {items.map((a) => (
            <li key={a.id} className={`alert-item alert-${a.severity === 'high' ? 'high' : a.severity === 'warning' ? 'medium' : 'info'}`}>
              <b>{a.title}</b>{a.zoneName && <span className="muted small"> · {a.zoneName}</span>}
              <div>{a.message}</div>
              <div className="muted small">{formatDateTime(a.timestamp)}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Safety() {
  return (
    <div className="page">
      <PageHeader title="Safety tools" subtitle="Extra protection when you are alone or travelling somewhere new." />
      <div className="grid-2">
        <div className="stack">
          <CheckInCard />
          <JourneyCard />
        </div>
        <div className="stack">
          <Advisories />
          <TrackingCard compact />
        </div>
      </div>
    </div>
  );
}
