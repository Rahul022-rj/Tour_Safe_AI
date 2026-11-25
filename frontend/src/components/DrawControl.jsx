// leaflet-draw integration for the zone manager.
//  <DrawControl onCreated>  adds the polygon / rectangle toolbar; onCreated(geometry) gets a GeoJSON Polygon
//  <ShapeEditor geometry onChange>  makes one existing polygon's vertices draggable; onChange(geometry) on every edit
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw'; // plugin: adds L.Control.Draw and polygon editing handlers to Leaflet
import 'leaflet-draw/dist/leaflet.draw.css';
import { polygonToLatLngs } from '../utils';

export default function DrawControl({ onCreated, enabled = true }) {
  const map = useMap(); // the Leaflet map created by <MapContainer>
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  useEffect(() => {
    if (!enabled) return undefined;
    const control = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: { allowIntersection: false, showArea: false }, // block self-crossing shapes
        rectangle: { showArea: false }, // showArea:true crashes leaflet-draw 1.0.4 ("type is not defined")
        polyline: false,
        circle: false, // circles are not GeoJSON polygons
        circlemarker: false,
        marker: false,
      },
    });
    map.addControl(control);

    // toGeoJSON() converts Leaflet's [lat, lng] shape into GeoJSON [lng, lat], the format the backend stores
    const handleCreated = (e) => onCreatedRef.current(e.layer.toGeoJSON().geometry);
    map.on(L.Draw.Event.CREATED, handleCreated);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.removeControl(control);
    };
  }, [map, enabled]);

  return null; // draws nothing itself; the toolbar is a Leaflet control
}

export function ShapeEditor({ geometry, onChange, color = '#0f766e' }) {
  const map = useMap();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initial = useRef(geometry); // edit the shape as it was when editing started

  useEffect(() => {
    const layer = L.polygon(polygonToLatLngs(initial.current), { color, weight: 3, dashArray: '6' }).addTo(map);
    layer.editing.enable();
    const emit = () => onChangeRef.current(layer.toGeoJSON().geometry);
    layer.on('edit', emit);
    map.fitBounds(layer.getBounds(), { padding: [40, 40] });
    return () => {
      layer.off('edit', emit);
      layer.editing.disable();
      map.removeLayer(layer);
    };
  }, [map, color]);

  return null;
}
