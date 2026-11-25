// Settings: which services are configured, operator accounts, experimental risk model, own password.
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { Badge, Card, ErrorBox, Field, PageHeader, Spinner, useAsync, useLoad, useToast } from '../../components/ui';
import { formatDateTime, isEmail, passwordProblems } from '../../utils';
import Profile from '../tourist/Profile';

const yes = (ok, label = ok ? 'configured' : 'not configured') => <Badge tone={ok ? 'success' : 'warning'}>{label}</Badge>;

function SystemStatus() {
  const { data, error, loading, reload } = useLoad(() => api('/admin/system'), []);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <Card title="System status" actions={<button className="btn btn-ghost btn-small" onClick={reload}>Refresh</button>}>
      <dl className="kv">
        <dt>Environment</dt><dd>{data.environment}</dd>
        <dt>Email (SMTP)</dt><dd>{yes(data.email.configured)} {data.email.host && <span className="muted small">{data.email.host}</span>}</dd>
        <dt>SMS (Twilio)</dt><dd>{yes(data.sms.configured)}</dd>
        <dt>Blockchain</dt><dd>{yes(data.blockchain.ok, data.blockchain.ok ? `online · chain ${data.blockchain.chainId}` : 'offline')} {!data.blockchain.ok && <span className="small text-danger">{data.blockchain.error}</span>}</dd>
        <dt>Routing</dt><dd>{yes(data.routing.enabled, data.routing.enabled ? 'enabled' : 'disabled')} <span className="muted small">{data.routing.provider}</span></dd>
        <dt>Geocoding</dt><dd>{yes(data.geocoding.enabled, data.geocoding.enabled ? 'enabled' : 'disabled')} <span className="muted small">{data.geocoding.provider}</span></dd>
        <dt>Places</dt><dd>{yes(data.places.enabled, data.places.enabled ? 'enabled' : 'disabled')} <span className="muted small">{data.places.providers.join(', ')}</span></dd>
        <dt>Tracking</dt><dd className="small">min interval {data.tracking.minIntervalMs / 1000}s · stale after {data.tracking.staleAfterMs / 1000}s · offline after {data.tracking.offlineAfterMs / 60000} min · history kept {data.tracking.retentionDays} days · zone alerts need accuracy ≤ {data.tracking.geofenceMaxAccuracyM} m</dd>
        <dt>Anomaly rules</dt><dd className="small">speed &gt; {data.anomaly.maxSpeedKmh} km/h (2 readings) · no update {data.anomaly.inactivityMin} min · restricted stay {data.anomaly.restrictedDwellMin} min</dd>
        <dt>SOS cooldown</dt><dd>{data.sosCooldownMs / 1000}s</dd>
      </dl>
      <p className="muted small">Settings are changed through environment variables in backend/.env (see .env.example) and need a backend restart.</p>
    </Card>
  );
}

function Operators() {
  const toast = useToast();
  const list = useLoad(() => api('/admin/operators'), []);
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const { busy, error, run } = useAsync();
  const pw = passwordProblems(f.password);
  async function create(e) {
    e.preventDefault();
    try {
      await run(() => api('/admin/operators', { method: 'POST', body: f }));
      toast(`Operator ${f.email} created`, { tone: 'success' });
      setF({ name: '', email: '', password: '' });
      list.reload();
    } catch {
      /* shown */
    }
  }
  return (
    <Card title="Operator accounts">
      {list.data && (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Last login</th></tr></thead>
          <tbody>{list.data.operators.map((o) => <tr key={o._id}><td>{o.name}</td><td>{o.email}</td><td className="small">{formatDateTime(o.lastLoginAt)}</td></tr>)}</tbody>
        </table>
      )}
      <form onSubmit={create} noValidate>
        <h4>Add an operator</h4>
        <div className="grid-2">
          <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email" error={f.email && !isEmail(f.email) ? 'Invalid email' : ''}><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Initial password" error={f.password && pw.length ? `Needs ${pw.join(', ')}` : ''}><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
        </div>
        <ErrorBox error={error} />
        <button className="btn btn-primary" disabled={busy || f.name.trim().length < 2 || !isEmail(f.email) || pw.length > 0}>{busy ? 'Creating…' : 'Create operator'}</button>
      </form>
    </Card>
  );
}

function RiskModel() {
  const toast = useToast();
  const models = useLoad(() => api('/admin/risk/models'), []);
  const train = useAsync();
  async function trainNow() {
    try {
      const { model } = await train.run(() => api('/admin/risk/train', { method: 'POST' }));
      toast(model.status === 'experimental' ? `Model v${model.version} trained` : `Not enough data to train (v${model.version} recorded as insufficient_data)`, { tone: model.status === 'experimental' ? 'success' : 'warning' });
      models.reload();
    } catch {
      /* shown */
    }
  }
  const pct = (v) => (v == null ? 'n/a' : `${Math.round(v * 100)}%`);
  return (
    <Card title="Risk prediction model" actions={<Badge tone="warning">experimental</Badge>}>
      <p className="small">
        Decision tree that predicts whether an SOS is reported in a ~1 km area during a 3-hour window, trained only on this system's own location and incident history,
        evaluated on the most recent 30% of the data (time-based split). It is advisory only: geofence alerts and SOS never depend on it.
      </p>
      <button className="btn btn-primary btn-small" onClick={trainNow} disabled={train.busy}>{train.busy ? 'Training…' : 'Train new version'}</button>
      <ErrorBox error={train.error} />
      {models.loading && !models.data ? <Spinner /> : models.data?.models.length === 0 ? <p className="muted small">No model trained yet.</p> : models.data && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Version</th><th>Trained</th><th>Status</th><th>Samples (pos.)</th><th>Precision</th><th>Recall</th><th>F1</th><th>Confusion (tp/fp/tn/fn)</th></tr></thead>
            <tbody>
              {models.data.models.map((m) => (
                <tr key={m._id}>
                  <td>v{m.version} {m.active && <Badge tone="success">active</Badge>}</td>
                  <td className="small">{formatDateTime(m.createdAt)}</td>
                  <td><Badge tone={m.status === 'experimental' ? 'info' : 'muted'}>{m.status}</Badge></td>
                  <td>{m.dataset.samples} ({m.dataset.positives})</td>
                  <td>{pct(m.metrics?.precision)}</td>
                  <td>{pct(m.metrics?.recall)}</td>
                  <td>{pct(m.metrics?.f1)}</td>
                  <td className="small">{m.metrics?.confusionMatrix ? `${m.metrics.confusionMatrix.tp}/${m.metrics.confusionMatrix.fp}/${m.metrics.confusionMatrix.tn}/${m.metrics.confusionMatrix.fn}` : m.metrics?.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {models.data && <details className="small"><summary>Limitations</summary><ul>{models.data.limitations.map((l) => <li key={l}>{l}</li>)}</ul></details>}
    </Card>
  );
}

export default function Settings() {
  const { user } = useAuth();
  return (
    <div className="page">
      <PageHeader title="Settings" subtitle={`Signed in as ${user.email}`} />
      <div className="stack">
        <SystemStatus />
        <RiskModel />
        <Operators />
        <Profile />
      </div>
    </div>
  );
}
