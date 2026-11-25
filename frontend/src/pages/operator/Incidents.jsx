// Operator incident manager: map + searchable/filterable list + detail with the Reported -> Assigned -> Resolved
// workflow, notes, history, blockchain proofs and integrity verification.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleMarker, Tooltip, useMap } from 'react-leaflet';
import MapView, { Legend } from '../../components/MapView';
import CheckList from '../../components/CheckList';
import { api } from '../../api';
import { useIncidents } from '../../hooks';
import { Badge, Card, EmptyState, ErrorBox, Field, PageHeader, Spinner, useAsync, useLoad, useToast } from '../../components/ui';
import { CHAIN_INFO, STATUS_INFO, formatDateTime, shortHash, timeAgo, toLatLng } from '../../utils';

const FILTERS = ['Open', 'Reported', 'Assigned', 'Resolved', ''];
const RESOLUTION = { resolved: 'Resolved', false_alarm: 'False alarm', cancelled_by_tourist: 'Cancelled by tourist' };

function PanTo({ position }) {
  const map = useMap();
  const [lat, lng] = position || [];
  useEffect(() => {
    if (lat !== undefined) map.flyTo([lat, lng], Math.max(map.getZoom(), 15));
  }, [lat, lng, map]);
  return null;
}

function Workflow({ incident, onChanged }) {
  const toast = useToast();
  const [officer, setOfficer] = useState('');
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('resolved');
  const { busy, error, run } = useAsync();
  if (incident.status === 'Resolved') return null;

  async function update(status) {
    try {
      // revision = the version we are looking at; the server answers 409 if someone changed it meanwhile
      await run(() => api(`/incidents/${incident._id}/status`, { method: 'PATCH', body: { status, assignedTo: officer, note, resolution, revision: incident.revision } }));
      toast(status === 'Assigned' ? `Assigned to ${officer}` : 'Incident resolved', { tone: 'success' });
      onChanged?.();
    } catch {
      /* shown */
    }
  }

  return (
    <div className="workflow">
      {incident.status === 'Reported' && (
        <Field label="Assign officer / unit"><input placeholder="e.g. Patrol Car 12" value={officer} onChange={(e) => setOfficer(e.target.value)} maxLength={100} /></Field>
      )}
      <Field label="Note for the history (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
      <div className="row">
        {incident.status === 'Reported' && <button className="btn btn-primary" onClick={() => update('Assigned')} disabled={busy || !officer.trim()}>Assign</button>}
        <select value={resolution} onChange={(e) => setResolution(e.target.value)} aria-label="Resolution">
          <option value="resolved">Resolved</option>
          <option value="false_alarm">False alarm</option>
        </select>
        <button className="btn btn-success" onClick={() => update('Resolved')} disabled={busy}>Mark resolved</button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

function Notes({ incident }) {
  const [text, setText] = useState('');
  const { busy, error, run } = useAsync();
  async function add(e) {
    e.preventDefault();
    try {
      await run(() => api(`/incidents/${incident._id}/notes`, { method: 'POST', body: { text, revision: incident.revision } }));
      setText('');
    } catch {
      /* shown */
    }
  }
  return (
    <div>
      <h4>Notes ({incident.notes?.length || 0})</h4>
      <ul className="history">
        {(incident.notes || []).map((n) => <li key={n._id}>{n.text} <span className="muted small">· {n.by?.name} · {formatDateTime(n.at)}</span></li>)}
      </ul>
      <form className="row" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note" maxLength={1000} aria-label="New note" />
        <button className="btn btn-ghost btn-small" disabled={busy || !text.trim()}>Add</button>
      </form>
      <ErrorBox error={error} />
    </div>
  );
}

function Integrity({ incident }) {
  const { busy, error, run } = useAsync();
  const [result, setResult] = useState(null);
  const check = async () => {
    try {
      setResult(await run(() => api(`/verify/incident/${incident._id}`)));
    } catch {
      /* shown */
    }
  };
  return (
    <div>
      <h4>Blockchain integrity</h4>
      <p className="small">Proof status: <Badge tone={CHAIN_INFO[incident.chainStatus]?.tone}>{CHAIN_INFO[incident.chainStatus]?.label || incident.chainStatus}</Badge>{incident.chainTxHash && <> · last confirmed tx <span className="mono">{shortHash(incident.chainTxHash)}</span></>}</p>
      <button className="btn btn-ghost btn-small" onClick={check} disabled={busy}>{busy ? 'Checking…' : 'Verify integrity'}</button>
      <ErrorBox error={error} />
      {result && (
        <>
          <CheckList result={result} />
          <details className="small">
            <summary>Proof history ({result.proofs.length})</summary>
            <table className="table">
              <thead><tr><th>Rev</th><th>Hash</th><th>Status</th><th>Tx</th></tr></thead>
              <tbody>{result.proofs.map((p) => <tr key={p.hash}><td>{p.revision}</td><td className="mono">{shortHash(p.hash)}</td><td>{p.status}</td><td className="mono">{shortHash(p.txHash)}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}

function Detail({ incident, onChanged }) {
  const t = incident.touristId || {};
  const [lat, lng] = toLatLng(incident.location);
  return (
    <Card title={`${incident.type}: ${t.name || 'Unknown tourist'}`} actions={<Badge tone={STATUS_INFO[incident.status].tone}>{incident.status}</Badge>}>
      {incident.message && <p className="incident-msg">"{incident.message}"</p>}
      <dl className="kv">
        <dt>Reported</dt><dd>{formatDateTime(incident.createdAt)} ({timeAgo(incident.createdAt)})</dd>
        <dt>Location</dt><dd>{lat.toFixed(5)}, {lng.toFixed(5)} {incident.locationSource === 'last_known' && <Badge tone="warning">last known</Badge>}{Number.isFinite(incident.locationAccuracy) && ` ± ${Math.round(incident.locationAccuracy)} m`} · <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`} target="_blank" rel="noreferrer">map ↗</a></dd>
        <dt>Address</dt><dd>{incident.address || <span className="muted">not available</span>}</dd>
        <dt>Tourist phone</dt><dd>{t.phone ? <a href={`tel:${t.phone}`}>{t.phone}</a> : '-'} · {t.nationality || ''}</dd>
        <dt>Emergency contact</dt><dd>{t.emergencyContact?.name} {t.emergencyContact?.phone && <a href={`tel:${t.emergencyContact.phone}`}>{t.emergencyContact.phone}</a>}</dd>
        <dt>Nearest police</dt><dd>{incident.nearestStation ? <>{incident.nearestStation.name} {incident.nearestStation.source === 'demo-seed' && <Badge tone="warning">DEMO</Badge>}</> : '-'}</dd>
        <dt>Assigned to</dt><dd>{incident.assignedTo || '-'}</dd>
        {incident.resolution && <><dt>Outcome</dt><dd>{RESOLUTION[incident.resolution]}</dd></>}
        <dt>Revision</dt><dd>{incident.revision}</dd>
      </dl>
      <h4>History</h4>
      <ul className="history">
        {incident.history.map((h) => <li key={h._id}><b>{h.status}</b> by {h.by?.name || 'unknown'} · {formatDateTime(h.at)}{h.note && `: ${h.note}`}</li>)}
      </ul>
      {/* key resets the inputs after each change */}
      <Workflow key={`${incident._id}-${incident.revision}`} incident={incident} onChanged={onChanged} />
      <Notes key={`n-${incident._id}`} incident={incident} />
      <Integrity key={`i-${incident._id}-${incident.revision}`} incident={incident} />
    </Card>
  );
}

export default function OperatorIncidents() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('Open');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { incidents, total, error, loading, reload } = useIncidents({ status: filter, type, q: query, from, to });
  const selectedId = params.get('id');
  // The selected incident may not be in the current filter (e.g. opened from an alert link): load it directly
  const direct = useLoad(() => (selectedId ? api(`/incidents/${selectedId}`) : Promise.resolve(null)), [selectedId]);
  const selected = incidents.find((i) => i._id === selectedId) || direct.data?.incident;
  const select = (id) => setParams(id ? { id } : {});

  return (
    <div className="page">
      <PageHeader title="Incident manager" subtitle={`${total} incident(s) match`} />
      <div className="filters">
        <div className="tabs">
          {FILTERS.map((f) => <button key={f || 'all'} className={`tab ${f === filter ? 'active' : ''}`} onClick={() => setFilter(f)}>{f || 'All'}</button>)}
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="">All types</option><option value="SOS">SOS</option><option value="ANOMALY">Anomaly</option><option value="ZONE_ALERT">Zone alert</option>
        </select>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setQuery(q); }}>
          <input placeholder="Search tourist, message, unit, address, id" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search incidents" />
          <button className="btn btn-ghost btn-small">Search</button>
        </form>
        <label className="small">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="small">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <ErrorBox error={error} onRetry={reload} />
      <div className="grid-main">
        <div>
          <MapView height={420}>
            {incidents.map((i) => (
              <CircleMarker key={i._id} center={toLatLng(i.location)} radius={i._id === selectedId ? 14 : 9} pathOptions={{ color: i._id === selectedId ? '#0f172a' : 'white', weight: 3, fillColor: STATUS_INFO[i.status].color, fillOpacity: 1 }} eventHandlers={{ click: () => select(i._id) }}>
                <Tooltip>{i.type}: {i.touristId?.name} ({i.status})</Tooltip>
              </CircleMarker>
            ))}
            {selected && <PanTo position={toLatLng(selected.location)} />}
          </MapView>
          <Legend items={Object.entries(STATUS_INFO).map(([s, v]) => ({ color: v.color, label: s }))} />
          <Card title="Incidents">
            {loading && incidents.length === 0 ? <Spinner /> : incidents.length === 0 ? <EmptyState title="No incidents match the filters" /> : (
              <table className="table table-click">
                <thead><tr><th>When</th><th>Type</th><th>Tourist</th><th>Status</th><th>Assigned</th><th>Chain</th></tr></thead>
                <tbody>
                  {incidents.map((i) => (
                    <tr key={i._id} className={i._id === selectedId ? 'selected' : ''} onClick={() => select(i._id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && select(i._id)}>
                      <td className="small">{formatDateTime(i.createdAt)}</td>
                      <td>{i.type}</td>
                      <td>{i.touristId?.name}</td>
                      <td><Badge tone={STATUS_INFO[i.status].tone}>{i.status}</Badge></td>
                      <td>{i.assignedTo || '-'}</td>
                      <td><Badge tone={CHAIN_INFO[i.chainStatus]?.tone}>{i.chainStatus}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
        <div>
          {direct.loading && selectedId && !selected ? <Spinner /> : selected ? <Detail incident={selected} onChanged={reload} /> : <EmptyState title="Select an incident">Click a marker or a row to see details and act on it.</EmptyState>}
          <ErrorBox error={direct.error} />
        </div>
      </div>
    </div>
  );
}
