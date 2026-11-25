// Operator live data: tourists with their latest real positions (REST snapshot + Socket.IO updates),
// SOS flags from open incidents, recent alerts, and the live map that draws them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleMarker, Polyline, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import MapView, { FitButton, Legend, MapButtons } from './MapView';
import { ZoneLayer } from './MapLayers';
import { api } from '../api';
import { useSocketEvent, useSocketReconnect } from '../SocketContext';
import { useIncidents, useNow, useZones } from '../hooks';
import { LIVE_STATUS, ZONE_INFO, computeLiveStatus, timeAgo, toLatLng } from '../utils';

const TRAIL_LENGTH = 40;

function fromApi(t) {
  return {
    userId: t._id,
    name: t.name,
    email: t.email,
    nationality: t.nationality,
    phone: t.phone,
    emergencyContact: t.emergencyContact,
    position: toLatLng(t.lastLocation),
    accuracy: t.lastAccuracy,
    timestamp: t.lastSeenAt,
    source: t.lastSource,
    zoneId: t.lastZoneId,
    zoneType: t.lastZoneType || 'none',
    trackingActive: t.trackingActive,
    online: t.online,
    accountStatus: t.status,
    trail: [],
  };
}

export function useLiveTourists() {
  const [tourists, setTourists] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const { incidents } = useIncidents({ status: 'Open' });

  const reload = useCallback(() => {
    return api('/tourists?limit=500')
      .then((data) =>
        setTourists((prev) => {
          const next = {};
          for (const t of data.tourists) next[t._id] = { ...fromApi(t), trail: prev[t._id]?.trail || [] };
          return next;
        })
      )
      .then(() => setError(null))
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  useSocketReconnect(reload);

  useSocketEvent('location:update', (u) => {
    setTourists((prev) => {
      const old = prev[u.userId] || { trail: [], userId: u.userId };
      const position = [u.lat, u.lng];
      const trail = u.reclassified ? old.trail : [...old.trail, position].slice(-TRAIL_LENGTH);
      return {
        ...prev,
        [u.userId]: { ...old, name: u.name, position, accuracy: u.accuracy, timestamp: u.timestamp, source: u.source, zoneId: u.zoneId, zoneType: u.zoneType, zoneConfidence: u.zoneConfidence, trackingActive: u.trackingActive ?? old.trackingActive, trail },
      };
    });
  });
  useSocketEvent('tourist:status', (s) => {
    setTourists((prev) => (prev[s.userId] ? { ...prev, [s.userId]: { ...prev[s.userId], ...('online' in s && { online: s.online }), ...('trackingActive' in s && { trackingActive: s.trackingActive }) } } : prev));
  });

  const sosIds = new Set(incidents.filter((i) => i.type === 'SOS').map((i) => i.touristId?._id || i.touristId));
  const list = Object.values(tourists)
    .map((t) => ({ ...t, sos: sosIds.has(t.userId) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { tourists: list, openIncidents: incidents, error, loading, reload };
}

export function useAlerts(limit = 50) {
  const [alerts, setAlerts] = useState([]);
  const merge = (a, b) => {
    const byId = new Map();
    for (const x of [...a, ...b]) byId.set(x.id, { ...byId.get(x.id), ...x });
    return [...byId.values()].sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp)).slice(0, limit);
  };
  const reload = useCallback(() => api('/tourists/alerts').then((d) => setAlerts((prev) => merge(prev, d.alerts))).catch(() => {}), []);
  useEffect(() => {
    reload();
  }, [reload]);
  useSocketReconnect(reload);
  useSocketEvent('alert', (a) => setAlerts((prev) => merge([a], prev)));
  useSocketEvent('alert:reviewed', (r) => setAlerts((prev) => prev.map((a) => (a.id === r.id ? { ...a, reviewedAt: r.reviewedAt } : a))));
  return { alerts, reload };
}

// Fits the map to the tourists' positions the first time positions are available
function AutoFit({ points }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    const valid = points.filter(Boolean);
    if (done.current || !valid.length) return;
    done.current = true;
    map.fitBounds(L.latLngBounds(valid), { padding: [40, 40], maxZoom: 15 });
  }, [points, map]);
  return null;
}

export function LiveMap({ tourists, openIncidents = [], height = 520, selectedId, onSelect }) {
  const { zones } = useZones();
  const now = useNow(5000);
  const withStatus = tourists.map((t) => ({ ...t, live: computeLiveStatus(t, now) }));
  return (
    <>
      <MapView
        height={height}
        overlays={[
          { name: 'Safety zones', content: <ZoneLayer zones={zones} /> },
          { name: 'Trails', content: withStatus.map((t) => t.trail.length > 1 && <Polyline key={`trail-${t.userId}`} positions={t.trail} pathOptions={{ color: '#1e293b', weight: 2, opacity: 0.35 }} />) },
          {
            name: 'Open incidents',
            content: openIncidents.map((i) => (
              <CircleMarker key={i._id} center={toLatLng(i.location)} radius={20} pathOptions={{ color: '#be123c', weight: 3, dashArray: '4', fillColor: '#be123c', fillOpacity: 0.12 }}>
                <Tooltip direction="top">{i.type}: {i.touristId?.name} ({i.status})</Tooltip>
              </CircleMarker>
            )),
          },
        ]}
      >
        {withStatus.filter((t) => t.position).map((t) => (
          <CircleMarker
            key={t.userId}
            center={t.position}
            radius={t.userId === selectedId ? 12 : 9}
            pathOptions={{ color: t.userId === selectedId ? '#0f172a' : 'white', weight: t.live === 'sos' ? 4 : 2, fillColor: LIVE_STATUS[t.live].color, fillOpacity: 1, dashArray: t.live === 'stale' || t.live === 'offline' ? '3' : undefined }}
            eventHandlers={onSelect ? { click: () => onSelect(t.userId) } : undefined}
          >
            <Popup>
              <b>{t.name}</b> {t.nationality && `(${t.nationality})`}
              <br />Status: {LIVE_STATUS[t.live].label}
              <br />Zone: {ZONE_INFO[t.zoneType || 'none'].label}{t.zoneConfidence === 'uncertain' && ' (uncertain)'}
              <br />Last update: {timeAgo(t.timestamp, now)} {t.source && `via ${t.source}`}
              {Number.isFinite(t.accuracy) && <><br />Accuracy ± {Math.round(t.accuracy)} m</>}
              <br />{t.online ? 'Connected now' : 'Not connected'}
              <br /><Link to={`/operator/tourists/${t.userId}`}>Details →</Link>
            </Popup>
          </CircleMarker>
        ))}
        <AutoFit points={withStatus.map((t) => t.position).concat(openIncidents.map((i) => toLatLng(i.location)))} />
        <MapButtons>
          <FitButton points={withStatus.map((t) => t.position)} label="⤢" title="Fit all tourists" />
        </MapButtons>
      </MapView>
      <Legend items={Object.entries(LIVE_STATUS).filter(([k]) => k !== 'no_data').map(([, v]) => ({ color: v.color, label: v.label }))} />
    </>
  );
}

export function AlertFeed({ alerts, compact = false }) {
  const now = useNow(10000);
  async function review(a) {
    await api(`/tourists/alerts/${a.id}/review`, { method: 'POST' }).catch(() => {});
  }
  if (!alerts.length) return <p className="muted small">No alerts yet. They appear on SOS, zone entries and movement anomalies.</p>;
  return (
    <ul className="alert-list">
      {alerts.slice(0, compact ? 8 : 50).map((a) => (
        <li key={a.id} className={`alert-item alert-${a.severity}`}>
          <div className="row-between">
            <b>{a.title}</b>
            <span className="muted small">{timeAgo(a.timestamp, now)}</span>
          </div>
          <div className="small">{a.message}</div>
          {a.kind === 'ANOMALY' && (
            a.reviewedAt ? <span className="badge badge-muted">reviewed</span> : <button className="btn btn-small btn-ghost" onClick={() => review(a)}>Mark reviewed</button>
          )}
          {a.touristId && <Link className="small" to={`/operator/tourists/${a.touristId}`}> tourist →</Link>}
          {a.incidentId && <Link className="small" to={`/operator/incidents?id=${a.incidentId}`}> incident →</Link>}
        </li>
      ))}
    </ul>
  );
}
