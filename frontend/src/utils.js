// Small display helpers shared by several pages

export const formatDate = (d) => (d ? new Date(d).toLocaleDateString() : '-');
export const formatDateTime = (d) => (d ? new Date(d).toLocaleString() : '-');

// "12s ago", "3 min ago", "2 h ago", or the full date for older times
export function timeAgo(date, now = Date.now()) {
  if (!date) return 'never';
  const seconds = Math.max(0, Math.round((now - new Date(date)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(date).toLocaleString();
}

export const formatDistance = (m) => (m == null ? '-' : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
export function formatDuration(s) {
  if (s == null) return '-';
  const min = Math.round(s / 60);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
export const shortHash = (h, n = 10) => (h ? `${h.slice(0, n)}…${h.slice(-6)}` : '-');

// COORDINATE CONVENTION: GeoJSON/Turf/MongoDB store [lng, lat]; Leaflet wants [lat, lng].
// Always convert with these helpers, never by hand.
export function toLatLng(geoPoint) {
  const c = geoPoint?.coordinates;
  return c?.length === 2 ? [c[1], c[0]] : null;
}
export const polygonToLatLngs = (geometry) => geometry.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]));
export const lineToLatLngs = (geometry) => geometry.coordinates.map(([lng, lat]) => [lat, lng]);

// Colour and label for each zone type ("none" = outside every zone)
export const ZONE_INFO = {
  red: { color: '#dc2626', label: 'Restricted', tone: 'danger' },
  yellow: { color: '#d97706', label: 'Caution', tone: 'warning' },
  green: { color: '#16a34a', label: 'Safe', tone: 'success' },
  none: { color: '#2563eb', label: 'Outside zones', tone: 'info' },
};

// Operator map status of a tourist
export const LIVE_STATUS = {
  sos: { color: '#be123c', label: 'SOS', tone: 'danger' },
  restricted: { color: '#dc2626', label: 'Restricted zone', tone: 'danger' },
  caution: { color: '#d97706', label: 'Caution zone', tone: 'warning' },
  safe: { color: '#16a34a', label: 'Safe', tone: 'success' },
  stale: { color: '#94a3b8', label: 'Stale location', tone: 'muted' },
  offline: { color: '#475569', label: 'Offline', tone: 'muted' },
  no_data: { color: '#cbd5e1', label: 'No location yet', tone: 'muted' },
};

// Colour for each incident status
export const STATUS_INFO = {
  Reported: { color: '#dc2626', tone: 'danger' },
  Assigned: { color: '#d97706', tone: 'warning' },
  Resolved: { color: '#16a34a', tone: 'success' },
};

export const CHAIN_INFO = {
  confirmed: { label: 'Confirmed on chain', tone: 'success' },
  pending: { label: 'Pending', tone: 'warning' },
  submitted: { label: 'Submitted', tone: 'warning' },
  failed: { label: 'Failed (retrying)', tone: 'danger' },
  not_submitted: { label: 'Not submitted', tone: 'muted' },
};

// Operator view: computes a live status on the client (same rules as the server's liveStatus)
export function computeLiveStatus(t, now, { staleMs = 60000, offlineMs = 600000 } = {}) {
  if (t.sos) return 'sos';
  if (!t.timestamp || !t.position) return 'no_data';
  const age = now - new Date(t.timestamp);
  if (t.trackingActive === false || age > offlineMs) return 'offline'; // stopped sharing / logged out
  if (age > staleMs) return 'stale';
  return { red: 'restricted', yellow: 'caution', green: 'safe' }[t.zoneType] || 'safe';
}

// Client-side form checks mirroring the server rules (the server always re-validates)
export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
export const isPhone = (v) => /^\+?[0-9]{7,15}$/.test(String(v).replace(/[\s\-().]/g, ''));
export function passwordProblems(pw) {
  const p = [];
  if (!pw || pw.length < 8) p.push('8+ characters');
  if (!/[a-z]/.test(pw || '')) p.push('a lower-case letter');
  if (!/[A-Z]/.test(pw || '')) p.push('an upper-case letter');
  if (!/[0-9]/.test(pw || '')) p.push('a digit');
  if (!/[^A-Za-z0-9]/.test(pw || '')) p.push('a symbol');
  return p;
}
