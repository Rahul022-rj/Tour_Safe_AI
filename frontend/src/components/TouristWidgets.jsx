// Widgets used on several tourist pages
import { Link } from 'react-router-dom';
import { useTracking } from '../tracking/TrackingContext';
import { useNow } from '../hooks';
import { Badge, Card } from './ui';
import { ZONE_INFO, timeAgo } from '../utils';

export function TrackingCard({ compact = false }) {
  const t = useTracking();
  const now = useNow(2000);
  const running = t.isTracking;
  const problem = ['denied', 'insecure', 'unsupported', 'unavailable', 'timeout'].includes(t.status);
  return (
    <Card title="Live location" actions={<Badge tone={t.status === 'active' ? 'success' : problem ? 'danger' : 'muted'}>{t.status}</Badge>}>
      {!running && t.status === 'idle' && !compact && (
        <p className="muted small">
          Sharing lets the control room see where you are and warns you when you enter a caution or restricted zone.
          Your browser will ask for permission. You can stop at any time.
        </p>
      )}
      <p className={problem ? 'notice notice-danger' : 'small'}>{t.statusText}</p>
      {t.permission === 'denied' && t.status !== 'denied' && <p className="notice notice-warning small">Location permission is blocked for this site in your browser settings.</p>}
      <dl className="kv">
        <dt>Accuracy</dt>
        <dd>{Number.isFinite(t.accuracy) ? `± ${Math.round(t.accuracy)} m` : Number.isFinite(t.serverFix?.accuracy) ? `± ${Math.round(t.serverFix.accuracy)} m (last)` : '-'}</dd>
        <dt>Last fix</dt>
        <dd>{t.fixAt ? timeAgo(t.fixAt, now) : t.serverFix?.at ? `${timeAgo(t.serverFix.at, now)} (last saved)` : 'never'}</dd>
        <dt>Sent to server</dt>
        <dd>{t.sentAt ? timeAgo(t.sentAt, now) : '-'}</dd>
      </dl>
      {Number.isFinite(t.accuracy) && t.accuracy > 100 && <p className="notice notice-warning small">Low accuracy: zone alerts are held back until a more precise reading arrives.</p>}
      {t.sendError && <p className="notice notice-danger small">Could not send location: {t.sendError}</p>}
      <div className="row">
        {running ? (
          <button className="btn btn-danger" onClick={t.stop}>Stop sharing</button>
        ) : (
          <button className="btn btn-primary" onClick={t.start}>{t.status === 'denied' ? 'Try again' : 'Start sharing location'}</button>
        )}
        {compact && <Link className="btn btn-ghost" to="/tourist/map">Open map</Link>}
      </div>
      <p className="muted small">Location comes from your browser (GPS, Wi-Fi or mobile network); GPS is not guaranteed.</p>
    </Card>
  );
}

export function ZoneStatusCard({ zones }) {
  const t = useTracking();
  const type = t.zone?.type || 'none';
  const info = ZONE_INFO[type] || ZONE_INFO.none;
  const zone = zones.find((z) => z._id === t.zone?.id);
  return (
    <Card title="Current safety status" className={`zone-card zone-${type}`}>
      <p className="zone-big" style={{ color: info.color }}>{t.position ? info.label : 'Unknown'}</p>
      {zone && <p><b>{zone.name}</b>{zone.description ? `: ${zone.description}` : ''}</p>}
      {t.zone?.confidence === 'uncertain' && <p className="notice notice-warning small">Your location is near a zone boundary or not precise enough to be sure.</p>}
      {!t.position && <p className="muted small">Start sharing your location to see your safety status.</p>}
      {type === 'red' && <p className="notice notice-danger">You are in a restricted area. Please leave it. Press SOS if you need help.</p>}
    </Card>
  );
}
