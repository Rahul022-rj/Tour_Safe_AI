// Zone manager: draw new geo-fence zones, edit name/type/description/source and the SHAPE, delete zones.
import { useState } from 'react';
import { Polygon } from 'react-leaflet';
import MapView, { Legend } from '../../components/MapView';
import { ZoneLayer } from '../../components/MapLayers';
import DrawControl, { ShapeEditor } from '../../components/DrawControl';
import { api } from '../../api';
import { useZones } from '../../hooks';
import { Badge, Card, EmptyState, ErrorBox, Field, PageHeader, Spinner, useAsync, useConfirm, useToast } from '../../components/ui';
import { ZONE_INFO, formatDate, polygonToLatLngs } from '../../utils';

const blank = { name: '', type: 'yellow', description: '', source: '' };

function ZoneForm({ value, onChange, onSubmit, onCancel, busy, error, submitText, extra }) {
  const set = (e) => onChange({ ...value, [e.target.name]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <Field label="Name"><input name="name" value={value.name} onChange={set} required maxLength={100} autoFocus /></Field>
      <Field label="Classification">
        <select name="type" value={value.type} onChange={set}>
          <option value="red">Red: restricted / high risk</option>
          <option value="yellow">Yellow: caution</option>
          <option value="green">Green: safe</option>
        </select>
      </Field>
      <Field label="Description (shown to tourists)"><input name="description" value={value.description} onChange={set} maxLength={500} /></Field>
      <Field label="Source of the risk information" hint="e.g. Police advisory 12/2026, flood warning, field survey"><input name="source" value={value.source} onChange={set} maxLength={200} /></Field>
      {extra}
      <ErrorBox error={error} />
      <div className="row">
        <button className="btn btn-primary" disabled={busy || !value.name.trim()}>{busy ? 'Saving…' : submitText}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function Zones() {
  const { zones, reload, error: loadError, loading } = useZones();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState(null); // { geometry, ...fields } for a new zone
  const [editing, setEditing] = useState(null); // { _id, ...fields, geometry, shapeChanged }
  const { busy, error, run, setError } = useAsync();

  async function create() {
    try {
      await run(() => api('/zones', { method: 'POST', body: draft }));
      toast(`Zone "${draft.name}" created`, { tone: 'success' });
      setDraft(null);
      reload();
    } catch {
      /* shown */
    }
  }

  async function save() {
    const body = { name: editing.name, type: editing.type, description: editing.description, source: editing.source };
    if (editing.shapeChanged) body.geometry = editing.geometry;
    try {
      await run(() => api(`/zones/${editing._id}`, { method: 'PUT', body }));
      toast('Zone updated', { tone: 'success' });
      setEditing(null);
      reload();
    } catch {
      /* shown */
    }
  }

  async function remove(zone) {
    if (!(await confirm({ title: `Delete zone "${zone.name}"?`, message: 'Tourists inside it will no longer be warned about this area.', confirmText: 'Delete', tone: 'danger' }))) return;
    try {
      await api(`/zones/${zone._id}`, { method: 'DELETE' });
      toast('Zone deleted', { tone: 'success' });
      if (editing?._id === zone._id) setEditing(null);
      reload();
    } catch (err) {
      toast(err.message, { tone: 'danger', title: 'Delete failed' });
    }
  }

  const startEdit = (z) => {
    setDraft(null);
    setError(null);
    setEditing({ _id: z._id, name: z.name, type: z.type, description: z.description || '', source: z.source || '', geometry: z.geometry, shapeChanged: false, editShape: false });
  };

  const visibleZones = zones.filter((z) => !(editing?.editShape && z._id === editing._id));

  return (
    <div className="page">
      <PageHeader title="Zone manager" subtitle="Draw with the polygon or rectangle tool (top left of the map). Overlapping zones: the highest risk wins." />
      <div className="grid-main">
        <div>
          <MapView height={560}>
            <ZoneLayer zones={visibleZones} onSelect={startEdit} selectedId={editing?._id} />
            {draft && <Polygon positions={polygonToLatLngs(draft.geometry)} pathOptions={{ color: ZONE_INFO[draft.type].color, dashArray: '6' }} />}
            {editing?.editShape && <ShapeEditor key={editing._id} geometry={editing.geometry} color={ZONE_INFO[editing.type].color} onChange={(geometry) => setEditing((e) => ({ ...e, geometry, shapeChanged: true }))} />}
            <DrawControl enabled={!editing?.editShape} onCreated={(geometry) => { setEditing(null); setError(null); setDraft({ ...blank, geometry }); }} />
          </MapView>
          <Legend items={['green', 'yellow', 'red'].map((t) => ({ color: ZONE_INFO[t].color, label: ZONE_INFO[t].label }))} />
          <p className="muted small">Click a zone on the map to edit it.</p>
        </div>
        <div className="stack">
          {draft && (
            <Card title="New zone">
              <ZoneForm value={draft} onChange={setDraft} onSubmit={create} onCancel={() => setDraft(null)} busy={busy} error={error} submitText="Save zone" />
            </Card>
          )}
          {editing && (
            <Card title="Edit zone">
              <ZoneForm
                value={editing}
                onChange={setEditing}
                onSubmit={save}
                onCancel={() => setEditing(null)}
                busy={busy}
                error={error}
                submitText="Save changes"
                extra={
                  <p className="small">
                    {editing.editShape
                      ? <>Drag the white squares on the map to move corners. {editing.shapeChanged && <Badge tone="warning">shape changed</Badge>}</>
                      : <button type="button" className="btn btn-ghost btn-small" onClick={() => setEditing({ ...editing, editShape: true })}>Edit shape on map</button>}
                  </p>
                }
              />
            </Card>
          )}
          <Card title={`Zones (${zones.length})`}>
            <ErrorBox error={loadError} onRetry={reload} />
            {loading ? <Spinner /> : zones.length === 0 ? <EmptyState title="No zones yet">Draw one on the map.</EmptyState> : (
              <ul className="zone-list">
                {zones.map((z) => (
                  <li key={z._id} className={editing?._id === z._id ? 'selected' : ''}>
                    <span className="dot" style={{ background: ZONE_INFO[z.type].color }} />
                    <span className="grow"><b>{z.name}</b><br /><span className="muted small">{ZONE_INFO[z.type].label} · {z.source || 'Operator-defined'} · {formatDate(z.reviewedAt || z.updatedAt)}</span></span>
                    <button className="btn btn-ghost btn-small" onClick={() => startEdit(z)}>Edit</button>
                    <button className="btn btn-danger btn-small" onClick={() => remove(z)}>Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
