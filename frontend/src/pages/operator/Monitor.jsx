// Live tourist monitoring: full map + searchable, filterable list + alert feed (with anomaly review)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertFeed, LiveMap, useAlerts, useLiveTourists } from '../../components/OperatorLive';
import { Badge, Card, EmptyState, ErrorBox, Spinner } from '../../components/ui';
import { useNow } from '../../hooks';
import { LIVE_STATUS, ZONE_INFO, computeLiveStatus, timeAgo } from '../../utils';

export default function Monitor() {
  const { tourists, openIncidents, error, loading, reload } = useLiveTourists();
  const { alerts } = useAlerts();
  const now = useNow(5000);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [panel, setPanel] = useState('tourists');

  const rows = tourists
    .map((t) => ({ ...t, live: computeLiveStatus(t, now) }))
    .filter((t) => (!q || `${t.name} ${t.email} ${t.nationality}`.toLowerCase().includes(q.toLowerCase())) && (!status || t.live === status));
  const counts = tourists.reduce((acc, t) => {
    const s = computeLiveStatus(t, now);
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page map-page">
      <div className="map-layout">
        <div className="map-col">
          <ErrorBox error={error} onRetry={reload} />
          <LiveMap tourists={tourists} openIncidents={openIncidents} height="calc(100vh - 170px)" selectedId={selected} onSelect={setSelected} />
        </div>
        <div className="side-col">
          <div className="chips">
            {Object.entries(LIVE_STATUS).map(([k, v]) => (
              <button key={k} className={`chip ${status === k ? 'active' : ''}`} onClick={() => setStatus(status === k ? '' : k)}>
                <span className="dot" style={{ background: v.color }} /> {v.label} {counts[k] || 0}
              </button>
            ))}
          </div>
          <Card>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={panel === 'tourists'} className={`tab ${panel === 'tourists' ? 'active' : ''}`} onClick={() => setPanel('tourists')}>Tourists ({rows.length})</button>
              <button role="tab" aria-selected={panel === 'alerts'} className={`tab ${panel === 'alerts' ? 'active' : ''}`} onClick={() => setPanel('alerts')}>Alerts ({alerts.length})</button>
            </div>
            {panel === 'tourists' ? (
              <>
                <input placeholder="Search name, email, nationality…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tourists" />
                {loading ? <Spinner /> : rows.length === 0 ? <EmptyState title="No tourists match" /> : (
                  <ul className="tourist-list">
                    {rows.map((t) => (
                      <li key={t.userId} className={t.userId === selected ? 'selected' : ''}>
                        <button className="link-row" onClick={() => setSelected(t.userId)}>
                          <span className="dot" style={{ background: LIVE_STATUS[t.live].color }} />
                          <span className="grow">
                            <b>{t.name}</b> {t.sos && <Badge tone="danger">SOS</Badge>}
                            <br />
                            <span className="small muted">{LIVE_STATUS[t.live].label} · {ZONE_INFO[t.zoneType || 'none'].label} · {timeAgo(t.timestamp, now)}{Number.isFinite(t.accuracy) && ` · ±${Math.round(t.accuracy)} m`}</span>
                          </span>
                        </button>
                        <Link className="small" to={`/operator/tourists/${t.userId}`}>Details</Link>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <AlertFeed alerts={alerts} />
            )}
          </Card>
          <p className="muted small">Positions come from the tourists' own devices while they share their location; accuracy depends on the device.</p>
        </div>
      </div>
    </div>
  );
}
