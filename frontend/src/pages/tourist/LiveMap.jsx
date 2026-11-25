// Tourist live map: own position + accuracy, safety zones, nearby police/hospitals, own route history,
// own incidents, and a safe-route planner (destination by search or by clicking the map).
import { useEffect, useState } from 'react';
import { CircleMarker, Marker, Polyline, Popup, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import MapView, { FitButton, FlyButton, HYDERABAD, Legend, MapButtons, MapClick } from '../../components/MapView';
import { PlacesLayer, SelfMarker, ZoneLayer } from '../../components/MapLayers';
import { TrackingCard, ZoneStatusCard } from '../../components/TouristWidgets';
import { Badge, Card, EmptyState, ErrorBox, Spinner, useAsync, useLoad, useToast } from '../../components/ui';
import { api, qs } from '../../api';
import { useIncidents, useZones } from '../../hooks';
import { useTracking } from '../../tracking/TrackingContext';
import { STATUS_INFO, ZONE_INFO, formatDistance, formatDuration, formatDateTime, lineToLatLngs, toLatLng } from '../../utils';

const destIcon = L.divIcon({ className: '', html: '<div class="place-pin place-dest">★</div>', iconSize: [26, 26], iconAnchor: [13, 13] });
const RISK_TONE = { clear: 'success', caution: 'warning', restricted: 'danger' };

function NearbyPanel({ position, places, setPlaces }) {
  const [type, setType] = useState('');
  const [radius, setRadius] = useState(5000);
  const { busy, error, run } = useAsync();
  const [meta, setMeta] = useState(null);
  async function search() {
    if (!position) return;
    try {
      const data = await run(() => api(`/geo/places${qs({ lat: position[0], lng: position[1], type, radius })}`));
      setPlaces(data.places);
      setMeta(data);
    } catch {
      /* shown */
    }
  }
  // search automatically once a position is known
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (position && !meta && !busy) search(); }, [Boolean(position)]);
  return (
    <div>
      <div className="row">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Category">
          <option value="">Police &amp; hospitals</option>
          <option value="police">Police stations</option>
          <option value="hospital">Hospitals</option>
        </select>
        <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Radius">
          <option value={2000}>2 km</option>
          <option value={5000}>5 km</option>
          <option value={10000}>10 km</option>
        </select>
        <button className="btn btn-primary btn-small" onClick={search} disabled={busy || !position}>{busy ? 'Searching…' : 'Search'}</button>
      </div>
      {!position && <p className="muted small">Share your location to search nearby.</p>}
      <ErrorBox error={error} onRetry={search} />
      {meta && (
        <>
          {meta.notes.map((n) => <p key={n} className="notice notice-info small">{n}</p>)}
          {places.length === 0 ? <EmptyState title="Nothing found in this radius" /> : (
            <ul className="place-list">
              {places.map((p) => (
                <li key={p.id}>
                  <div><b>{p.name}</b> {p.source === 'demo-seed' && <Badge tone="warning">DEMO</Badge>}</div>
                  <div className="small">{p.type === 'police' ? 'Police' : 'Hospital'} · {formatDistance(p.distanceM)}{p.phone && <> · <a href={`tel:${p.phone}`}>{p.phone}</a></>}</div>
                  <a className="small" href={p.directionsUrl} target="_blank" rel="noreferrer">Directions ↗</a>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">{meta.attribution} · {formatDateTime(meta.generatedAt)}</p>
        </>
      )}
    </div>
  );
}

function RoutePanel({ position, dest, setDest, route, setRoute, picking, setPicking }) {
  const toast = useToast();
  const journeyState = useAsync();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [mode, setMode] = useState('foot');
  const searchState = useAsync();
  const routeState = useAsync();

  async function search(e) {
    e.preventDefault();
    try {
      setResults((await searchState.run(() => api(`/geo/search?q=${encodeURIComponent(q)}`))).results);
    } catch {
      /* shown */
    }
  }
  async function plan() {
    if (!position || !dest) return;
    try {
      const data = await routeState.run(() => api(`/geo/route${qs({ fromLat: position[0], fromLng: position[1], toLat: dest.lat, toLng: dest.lng, mode })}`));
      setRoute({ ...data, selected: data.recommendedIndex, mode });
    } catch {
      setRoute(null);
    }
  }

  async function startJourney() {
    const r = route.routes.find((x) => x.index === route.selected);
    try {
      await journeyState.run(() => api('/safety/journey', { method: 'POST', body: { route: r.geometry, destination: dest, destinationName: dest.name?.split(',')[0], mode: route.mode, distanceM: r.distanceM, durationS: r.durationS } }));
      toast('The control room is told if you leave this route or arrive late. Keep location sharing on.', { tone: 'success', title: 'Journey started' });
    } catch {
      /* shown */
    }
  }

  return (
    <div>
      <form className="row" onSubmit={search}>
        <input placeholder="Search a destination…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Destination search" />
        <button className="btn btn-small btn-ghost" disabled={searchState.busy || q.trim().length < 3}>{searchState.busy ? '…' : 'Find'}</button>
      </form>
      <ErrorBox error={searchState.error} />
      {results.length > 0 && (
        <ul className="place-list">
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button className="link" onClick={() => { setDest(r); setResults([]); setRoute(null); }}>{r.name}</button>
            </li>
          ))}
        </ul>
      )}
      <p className="small">
        <button className={`btn btn-small ${picking ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPicking(!picking)}>{picking ? 'Click on the map…' : 'Pick on map'}</button>{' '}
        {dest && <span>Destination: <b>{dest.name || `${dest.lat.toFixed(5)}, ${dest.lng.toFixed(5)}`}</b></span>}
      </p>
      <div className="row">
        <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Travel mode">
          <option value="foot">Walking</option>
          <option value="car">Driving</option>
          <option value="bike">Cycling</option>
        </select>
        <button className="btn btn-primary btn-small" onClick={plan} disabled={!position || !dest || routeState.busy}>{routeState.busy ? 'Planning…' : 'Get safe route'}</button>
      </div>
      {!position && <p className="muted small">Your current location is used as the start. Share your location first.</p>}
      <ErrorBox error={routeState.error} onRetry={plan} />
      {route && (
        <div className="routes">
          {route.warnings.map((w) => <p key={w} className="notice notice-warning small">{w}</p>)}
          {route.routes.map((r, i) => (
            <button key={r.index} className={`route-opt ${route.selected === r.index ? 'active' : ''}`} onClick={() => setRoute({ ...route, selected: r.index })}>
              <span><b>{i === 0 ? 'Recommended' : `Alternative ${i}`}</b> · {formatDistance(r.distanceM)} · {formatDuration(r.durationS)}</span>
              <Badge tone={RISK_TONE[r.risk]}>{r.risk === 'clear' ? 'no known risk zones' : r.risk}</Badge>
              {r.zones.length > 0 && <span className="small">Passes: {r.zones.map((z) => `${z.name} (${ZONE_INFO[z.type].label})`).join(', ')}</span>}
            </button>
          ))}
          <button className="btn btn-primary btn-small" onClick={startJourney} disabled={journeyState.busy}>{journeyState.busy ? 'Starting…' : 'Start journey with the selected route'}</button>
          <ErrorBox error={journeyState.error} />
          <p className="muted small">{route.disclaimer}</p>
          <p className="muted small">Routing: {route.routingSource}. Risk data: {route.riskSource.description} ({route.riskSource.zoneCount} zones{route.riskSource.lastReviewedAt ? `, last reviewed ${formatDateTime(route.riskSource.lastReviewedAt)}` : ''}). Generated {formatDateTime(route.generatedAt)}.</p>
          <p className="muted small">{route.note}</p>
        </div>
      )}
    </div>
  );
}

export default function TouristMap() {
  const t = useTracking();
  const { zones, error: zoneError } = useZones();
  const { incidents } = useIncidents();
  const history = useLoad(() => api('/tourists/me/locations?limit=300'), []);
  const [tab, setTab] = useState('nearby');
  const [places, setPlaces] = useState([]);
  const [dest, setDest] = useState(null);
  const [route, setRoute] = useState(null);
  const [picking, setPicking] = useState(false);

  const position = t.position;
  const trail = (history.data?.locations || []).map((l) => toLatLng(l.location)).reverse();
  const selectedRoute = route?.routes.find((r) => r.index === route.selected);

  return (
    <div className="page map-page">
      <div className="map-layout">
        <div className="map-col">
          <MapView
            center={position || HYDERABAD}
            zoom={position ? 15 : 13}
            height="calc(100vh - 170px)"
            overlays={[
              { name: 'Safety zones', content: <ZoneLayer zones={zones} /> },
              { name: 'Police & hospitals', content: <PlacesLayer places={places} /> },
              { name: 'My route history', content: trail.length > 1 && <Polyline positions={trail} pathOptions={{ color: '#334155', weight: 3, opacity: 0.5 }} /> },
              {
                name: 'My incidents',
                content: incidents.map((i) => (
                  <CircleMarker key={i._id} center={toLatLng(i.location)} radius={11} pathOptions={{ color: STATUS_INFO[i.status].color, weight: 3, fillOpacity: 0.2, dashArray: '4' }}>
                    <Tooltip>{i.type} · {i.status}</Tooltip>
                  </CircleMarker>
                )),
              },
            ]}
          >
            <SelfMarker position={position} accuracy={t.accuracy ?? t.serverFix?.accuracy} />
            {selectedRoute && <Polyline positions={lineToLatLngs(selectedRoute.geometry)} pathOptions={{ color: selectedRoute.risk === 'restricted' ? '#dc2626' : '#0f766e', weight: 6, opacity: 0.85 }} />}
            {route?.routes.filter((r) => r.index !== route.selected).map((r) => (
              <Polyline key={r.index} positions={lineToLatLngs(r.geometry)} pathOptions={{ color: '#64748b', weight: 4, opacity: 0.45, dashArray: '6' }} eventHandlers={{ click: () => setRoute({ ...route, selected: r.index }) }} />
            ))}
            {dest && <Marker position={[dest.lat, dest.lng]} icon={destIcon}><Popup>Destination</Popup></Marker>}
            {picking && <MapClick onClick={([lat, lng]) => { setDest({ lat, lng }); setPicking(false); setRoute(null); setTab('route'); }} />}
            <MapButtons>
              <FlyButton position={position} label="◎" title="Centre on my location" />
              <FitButton points={[position, dest && [dest.lat, dest.lng], ...places.map((p) => [p.lat, p.lng])]} label="⤢" title="Show everything" />
            </MapButtons>
          </MapView>
          <Legend items={[
            { color: ZONE_INFO.green.color, label: 'Safe zone' }, { color: ZONE_INFO.yellow.color, label: 'Caution zone' }, { color: ZONE_INFO.red.color, label: 'Restricted zone' },
            { color: '#2563eb', label: 'You (circle = accuracy)' }, { color: '#1d4ed8', label: 'P = police' }, { color: '#be123c', label: 'H = hospital' },
          ]} />
          <ErrorBox error={zoneError} />
        </div>
        <div className="side-col">
          <ZoneStatusCard zones={zones} />
          <TrackingCard />
          <Card>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'nearby'} className={`tab ${tab === 'nearby' ? 'active' : ''}`} onClick={() => setTab('nearby')}>Nearby help</button>
              <button role="tab" aria-selected={tab === 'route'} className={`tab ${tab === 'route' ? 'active' : ''}`} onClick={() => setTab('route')}>Safe route</button>
            </div>
            {tab === 'nearby'
              ? <NearbyPanel position={position} places={places} setPlaces={setPlaces} />
              : <RoutePanel position={position} dest={dest} setDest={setDest} route={route} setRoute={setRoute} picking={picking} setPicking={setPicking} />}
          </Card>
          {history.loading && <Spinner label="Loading history…" />}
        </div>
      </div>
    </div>
  );
}
