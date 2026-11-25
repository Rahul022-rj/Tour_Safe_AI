// Tourist management: searchable list and a detail page with location history, incidents, alerts and suspension
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CircleMarker, Polyline, Tooltip } from 'react-leaflet';
import MapView, { FitButton, MapButtons } from '../../components/MapView';
import { ZoneLayer } from '../../components/MapLayers';
import { api, qs } from '../../api';
import { useZones } from '../../hooks';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Spinner, useConfirm, useLoad, useToast } from '../../components/ui';
import { CHAIN_INFO, LIVE_STATUS, STATUS_INFO, ZONE_INFO, formatDate, formatDateTime, timeAgo, toLatLng } from '../../utils';

export default function Tourists() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [account, setAccount] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => api(`/tourists${qs({ q: query, status, account, page, limit: 50 })}`), [query, status, account, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <div className="page">
      <PageHeader title="Tourists" subtitle={data ? `${data.total} registered` : ''} />
      <div className="filters">
        <form className="row" onSubmit={(e) => { e.preventDefault(); setPage(1); setQuery(q); }}>
          <input placeholder="Search name, email, phone, nationality" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tourists" />
          <button className="btn btn-ghost btn-small">Search</button>
        </form>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Live status">
          <option value="">Any live status</option>
          {Object.entries(LIVE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={account} onChange={(e) => { setPage(1); setAccount(e.target.value); }} aria-label="Account status">
          <option value="">Any account</option><option value="active">Active</option><option value="suspended">Suspended</option>
        </select>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <Card>
        {loading && !data ? <Spinner /> : data.tourists.length === 0 ? <EmptyState title="No tourists found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Nationality</th><th>Live status</th><th>Last seen</th><th>Trip</th><th>Digital ID</th><th>Account</th><th /></tr></thead>
              <tbody>
                {data.tourists.map((t) => (
                  <tr key={t._id}>
                    <td><b>{t.name}</b><br /><span className="muted small">{t.email}</span></td>
                    <td>{t.nationality}</td>
                    <td><Badge tone={LIVE_STATUS[t.liveStatus].tone}>{LIVE_STATUS[t.liveStatus].label}</Badge>{t.online && <span className="muted small"> · online</span>}</td>
                    <td className="small">{timeAgo(t.lastSeenAt)}</td>
                    <td className="small">{formatDate(t.tripStart)} – {formatDate(t.tripEnd)}</td>
                    <td>{t.idRevokedAt ? <Badge tone="danger">revoked</Badge> : <Badge tone={CHAIN_INFO[t.idChainStatus]?.tone}>{t.idChainStatus}</Badge>}</td>
                    <td><Badge tone={t.status === 'active' ? 'success' : 'danger'}>{t.status}</Badge></td>
                    <td><Link to={`/operator/tourists/${t._id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="pager">
            <button className="btn btn-ghost btn-small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span className="small">Page {page} of {pages}</span>
            <button className="btn btn-ghost btn-small" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </Card>
    </div>
  );
}

export function TouristDetail() {
  const { id } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const { zones } = useZones();
  const detail = useLoad(() => api(`/tourists/${id}`), [id]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const history = useLoad(() => api(`/tourists/${id}/locations${qs({ from, to, limit: 2000 })}`), [id, from, to]);

  async function setStatus(status) {
    const reason = await confirm({
      title: status === 'suspended' ? 'Suspend this account?' : 'Re-activate this account?',
      message: status === 'suspended' ? 'The tourist is logged out everywhere and cannot log in until re-activated.' : 'The tourist can log in again.',
      confirmText: status === 'suspended' ? 'Suspend' : 'Activate',
      tone: status === 'suspended' ? 'danger' : 'primary',
      input: { label: 'Reason (for the audit log)', required: true, minLength: 3 },
    });
    if (!reason) return;
    try {
      await api(`/tourists/${id}/status`, { method: 'PATCH', body: { status, reason } });
      toast(`Account ${status}`, { tone: 'success' });
      detail.reload();
    } catch (err) {
      toast(err.message, { tone: 'danger' });
    }
  }

  if (detail.loading && !detail.data) return <Spinner />;
  if (detail.error) return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  const { tourist: t, incidents, alerts } = detail.data;
  const points = (history.data?.locations || []).map((l) => ({ pos: toLatLng(l.location), at: l.timestamp, zone: l.zoneType, acc: l.accuracy, source: l.source })).reverse();

  return (
    <div className="page">
      <PageHeader
        title={t.name}
        subtitle={<><Link to="/operator/tourists">← All tourists</Link> · <Badge tone={LIVE_STATUS[t.liveStatus].tone}>{LIVE_STATUS[t.liveStatus].label}</Badge></>}
        actions={t.status === 'active' ? <button className="btn btn-danger btn-small" onClick={() => setStatus('suspended')}>Suspend account</button> : <button className="btn btn-primary btn-small" onClick={() => setStatus('active')}>Re-activate</button>}
      />
      <div className="grid-main">
        <Card title="Location history" actions={<span className="row small"><label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></span>}>
          <MapView height={420} center={toLatLng(t.lastLocation) || undefined} zoom={14}>
            <ZoneLayer zones={zones} />
            {points.length > 1 && <Polyline positions={points.map((p) => p.pos)} pathOptions={{ color: '#334155', weight: 3, opacity: 0.6 }} />}
            {points.filter((_, i) => i % Math.ceil(points.length / 60 || 1) === 0 || i === points.length - 1).map((p) => (
              <CircleMarker key={`${p.at}`} center={p.pos} radius={4} pathOptions={{ color: ZONE_INFO[p.zone || 'none'].color, fillOpacity: 1 }}>
                <Tooltip>{formatDateTime(p.at)} · {ZONE_INFO[p.zone || 'none'].label}{Number.isFinite(p.acc) && ` · ±${Math.round(p.acc)} m`} · {p.source}</Tooltip>
              </CircleMarker>
            ))}
            <MapButtons><FitButton points={points.map((p) => p.pos)} label="⤢" title="Fit history" /></MapButtons>
          </MapView>
          {history.loading ? <Spinner /> : <p className="muted small">{points.length} points{points.length ? `, ${formatDateTime(points[0].at)} – ${formatDateTime(points.at(-1).at)}` : ''}. History older than the retention period is deleted automatically.</p>}
        </Card>
        <div className="stack">
          <Card title="Profile">
            <dl className="kv">
              <dt>Email</dt><dd>{t.email}</dd>
              <dt>Phone</dt><dd>{t.phone ? <a href={`tel:${t.phone}`}>{t.phone}</a> : '-'}</dd>
              <dt>Nationality</dt><dd>{t.nationality}</dd>
              <dt>Trip</dt><dd>{formatDate(t.tripStart)} – {formatDate(t.tripEnd)}</dd>
              <dt>Emergency</dt><dd>{t.emergencyContact?.name} ({t.emergencyContact?.relation || '-'}) {t.emergencyContact?.phone}</dd>
              <dt>Account</dt><dd><Badge tone={t.status === 'active' ? 'success' : 'danger'}>{t.status}</Badge></dd>
              <dt>Tracking</dt><dd>{t.trackingActive ? 'on' : 'off'} · last seen {timeAgo(t.lastSeenAt)}{t.online && ' · connected'}</dd>
              <dt>Digital ID</dt><dd>{t.idRevokedAt ? <Badge tone="danger">revoked</Badge> : <Badge tone={CHAIN_INFO[t.idChainStatus]?.tone}>{t.idChainStatus}</Badge>} <Link className="small" to={`/operator/verify?id=${t.idHash}`}>verify</Link></dd>
            </dl>
          </Card>
          <Card title={`Incidents (${incidents.length})`}>
            {incidents.length === 0 ? <p className="muted small">None</p> : incidents.map((i) => (
              <Link key={i._id} className="list-row link-row" to={`/operator/incidents?id=${i._id}`}>
                <Badge tone={STATUS_INFO[i.status].tone}>{i.status}</Badge> {i.type} · {formatDateTime(i.createdAt)}
              </Link>
            ))}
          </Card>
          <Card title="Recent alerts">
            {alerts.length === 0 ? <p className="muted small">None</p> : (
              <ul className="alert-list">{alerts.map((a) => <li key={a.id} className={`alert-item alert-${a.severity}`}><b>{a.title}</b> <span className="muted small">{formatDateTime(a.timestamp)}</span><div className="small">{a.message || a.touristMessage}</div></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
