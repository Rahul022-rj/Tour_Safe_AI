// Map layers shared by tourist and operator pages
import { Circle, CircleMarker, Marker, Polygon, Popup, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { ZONE_INFO, polygonToLatLngs, formatDistance, formatDate } from '../utils';

// Geo-fence zones as coloured polygons. Hover shows the name; click shows details and data source.
export function ZoneLayer({ zones, onSelect, selectedId }) {
  return zones.map((zone) => (
    <Polygon
      key={zone._id}
      positions={polygonToLatLngs(zone.geometry)}
      pathOptions={{ color: ZONE_INFO[zone.type].color, weight: zone._id === selectedId ? 4 : 2, fillOpacity: zone.type === 'red' ? 0.22 : 0.14, dashArray: zone._id === selectedId ? '6' : undefined }}
      eventHandlers={onSelect ? { click: () => onSelect(zone) } : undefined}
    >
      <Tooltip sticky>
        <b>{zone.name}</b> ({ZONE_INFO[zone.type].label})
      </Tooltip>
      {!onSelect && (
        <Popup>
          <b>{zone.name}</b> <span className={`badge badge-${ZONE_INFO[zone.type].tone}`}>{ZONE_INFO[zone.type].label}</span>
          {zone.description && <p>{zone.description}</p>}
          <div className="muted small">Source: {zone.source || 'Operator-defined'} · reviewed {formatDate(zone.reviewedAt || zone.updatedAt)}</div>
        </Popup>
      )}
    </Polygon>
  ));
}

const placeIcon = (type, demo) =>
  L.divIcon({
    className: '',
    html: `<div class="place-pin place-${type} ${demo ? 'place-demo' : ''}" aria-hidden="true">${type === 'police' ? 'P' : 'H'}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -12],
  });

export function PlacesLayer({ places }) {
  return places.map((p) => (
    <Marker key={p.id} position={[p.lat, p.lng]} icon={placeIcon(p.type, p.source === 'demo-seed')}>
      <Popup>
        <b>{p.name}</b> {p.source === 'demo-seed' && <span className="badge badge-warning">DEMO</span>}
        <div className="small">{p.type === 'police' ? 'Police station' : 'Hospital'} · {formatDistance(p.distanceM)}</div>
        {p.address && <div className="small">{p.address}</div>}
        {p.phone ? <div className="small">Phone: <a href={`tel:${p.phone}`}>{p.phone}</a> <span className="muted">(unverified)</span></div> : <div className="small muted">No phone number in the data</div>}
        <div className="small"><a href={p.directionsUrl} target="_blank" rel="noreferrer">Directions ↗</a></div>
        <div className="muted small">Source: {p.source === 'openstreetmap' ? 'OpenStreetMap (community data)' : 'Demo seed data, not verified'}</div>
      </Popup>
    </Marker>
  ));
}

// The device's position with its accuracy circle
export function SelfMarker({ position, accuracy, label = 'You are here' }) {
  if (!position) return null;
  return (
    <>
      {Number.isFinite(accuracy) && accuracy > 0 && (
        <Circle center={position} radius={accuracy} pathOptions={{ color: '#2563eb', weight: 1, fillOpacity: 0.08 }} interactive={false} />
      )}
      <CircleMarker center={position} radius={9} pathOptions={{ color: 'white', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}>
        <Popup>
          {label}
          {Number.isFinite(accuracy) && <div className="small muted">Accuracy about {Math.round(accuracy)} m</div>}
        </Popup>
      </CircleMarker>
    </>
  );
}
