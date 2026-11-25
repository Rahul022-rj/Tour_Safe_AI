// Base map used by every page: OpenStreetMap tiles with attribution, zoom, layer switcher, and optional
// overlay groups that the user can toggle. Markers and layers are passed in as children / overlays.
import { useEffect, useRef } from 'react';
import { LayersControl, MapContainer, TileLayer, LayerGroup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css'; // without this the tiles render scrambled

export const HYDERABAD = [17.392, 78.455]; // centre of the demo area [lat, lng]
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// overlays: [{ name, checked, content }] -> toggleable layers in the layer control
export default function MapView({ center = HYDERABAD, zoom = 13, height = 520, children, overlays = [], className = '' }) {
  return (
    <div className={`map-wrap ${className}`} style={{ height }}>
      <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Street map">
            <TileLayer attribution={OSM_ATTRIBUTION} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} referrerPolicy="strict-origin-when-cross-origin" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Humanitarian">
            <TileLayer attribution={`${OSM_ATTRIBUTION}, tiles by HOT`} url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png" maxZoom={19} referrerPolicy="strict-origin-when-cross-origin" />
          </LayersControl.BaseLayer>
          {overlays.map((o) => (
            <LayersControl.Overlay key={o.name} name={o.name} checked={o.checked !== false}>
              <LayerGroup>{o.content}</LayerGroup>
            </LayersControl.Overlay>
          ))}
        </LayersControl>
        {children}
      </MapContainer>
    </div>
  );
}

// Buttons drawn on top of the map (e.g. "My location"). Clicks do not reach the map underneath.
export function MapButtons({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      L.DomEvent.disableClickPropagation(ref.current);
      L.DomEvent.disableScrollPropagation(ref.current);
    }
  }, []);
  return <div ref={ref} className="map-buttons leaflet-bar">{children}</div>;
}

// "Centre on me" / "Fit all" helper: flies to a position at a zoom level
export function FlyButton({ position, zoom = 16, label, title, disabled }) {
  const map = useMap();
  return (
    <button type="button" className="map-btn" title={title || label} aria-label={title || label} disabled={disabled || !position} onClick={() => position && map.flyTo(position, Math.max(map.getZoom(), zoom))}>
      {label}
    </button>
  );
}

export function FitButton({ points, label = 'Fit', title = 'Show everything' }) {
  const map = useMap();
  const valid = points.filter(Boolean);
  return (
    <button type="button" className="map-btn" title={title} aria-label={title} disabled={!valid.length} onClick={() => valid.length && map.fitBounds(L.latLngBounds(valid), { padding: [40, 40], maxZoom: 16 })}>
      {label}
    </button>
  );
}

// Calls onClick([lat, lng]) when the map is clicked (used to pick a route destination)
export function MapClick({ onClick }) {
  const map = useMap();
  const ref = useRef(onClick);
  ref.current = onClick;
  useEffect(() => {
    const handler = (e) => ref.current?.([e.latlng.lat, e.latlng.lng]);
    map.on('click', handler);
    return () => map.off('click', handler);
  }, [map]);
  return null;
}

export function Legend({ items }) {
  return (
    <div className="legend" aria-label="Map legend">
      {items.map((i) => (
        <span key={i.label}>
          <span className={`dot ${i.ring ? 'dot-ring' : ''}`} style={{ background: i.ring ? 'transparent' : i.color, borderColor: i.color }} /> {i.label}
        </span>
      ))}
    </div>
  );
}
