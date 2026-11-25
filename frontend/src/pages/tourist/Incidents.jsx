// Tourist incident history with status timeline
import { useState } from 'react';
import { useIncidents } from '../../hooks';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { STATUS_INFO, formatDateTime } from '../../utils';

const RESOLUTION = { resolved: 'Resolved', false_alarm: 'False alarm', cancelled_by_tourist: 'Cancelled by you' };

export default function TouristIncidents() {
  const [status, setStatus] = useState('');
  const { incidents, error, loading, reload } = useIncidents(status ? { status } : {});
  return (
    <div className="page">
      <PageHeader title="My incidents" actions={
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All</option>
          <option value="Open">Open</option>
          <option value="Resolved">Resolved</option>
        </select>
      } />
      <ErrorBox error={error} onRetry={reload} />
      {loading && incidents.length === 0 ? <Spinner /> : incidents.length === 0 ? <EmptyState title="No incidents">Incidents appear here after you press SOS.</EmptyState> : (
        <div className="stack">
          {incidents.map((i) => (
            <Card key={i._id} title={`${i.type} · ${formatDateTime(i.createdAt)}`} actions={<Badge tone={STATUS_INFO[i.status].tone}>{i.status}</Badge>}>
              {i.message && <p>"{i.message}"</p>}
              <dl className="kv">
                <dt>Location</dt><dd>{i.location.coordinates[1].toFixed(5)}, {i.location.coordinates[0].toFixed(5)} ({i.locationSource === 'last_known' ? 'last known' : 'live'})</dd>
                {i.address && <><dt>Address</dt><dd>{i.address}</dd></>}
                <dt>Handled by</dt><dd>{i.assignedTo || '-'}</dd>
                {i.resolution && <><dt>Outcome</dt><dd>{RESOLUTION[i.resolution]}</dd></>}
                {i.nearestStation && <><dt>Nearest police</dt><dd>{i.nearestStation.name} {i.nearestStation.source === 'demo-seed' && <Badge tone="warning">DEMO</Badge>}</dd></>}
              </dl>
              <ul className="history">
                {i.history.map((h) => <li key={h._id}><b>{h.status}</b> · {formatDateTime(h.at)} · {h.by?.name || ''}{h.note && `: ${h.note}`}</li>)}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
