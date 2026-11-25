// Tourist's Digital ID: QR code (contains only the hash) and its live verification / blockchain status.
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { useSocketEvent } from '../../SocketContext';
import CheckList from '../../components/CheckList';
import { Badge, Card, ErrorBox, PageHeader, Spinner, useLoad } from '../../components/ui';
import { CHAIN_INFO, formatDate } from '../../utils';

export default function DigitalIdPage() {
  const { user, refreshUser } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api('/verify/my-id'), []);
  const [copied, setCopied] = useState(false);

  // If an officer revokes this ID, or the chain confirms it, the server tells us and we refresh
  useSocketEvent('alert', (alert) => {
    if (['ID_REVOKED', 'ID_STATUS'].includes(alert.kind)) {
      reload();
      refreshUser().catch(() => {});
    }
  });

  async function copy() {
    await navigator.clipboard?.writeText(data.idHash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="page">
      <PageHeader title="Digital ID" subtitle="Show this QR code to an officer. It contains only a fingerprint (hash) of your identity, no personal data." actions={<button className="btn btn-ghost btn-small" onClick={reload} disabled={loading}>Refresh status</button>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="grid-2">
          <Card className="id-card">
            <div className="id-card-head">
              <div>
                <div className="muted small">TourSafe Digital ID</div>
                <h2>{user.name}</h2>
                <div className="small">{user.nationality} · Trip {formatDate(user.tripStart)} – {formatDate(user.tripEnd)}</div>
              </div>
              <Badge tone={data.result.valid ? 'success' : ['REVOKED', 'TAMPERED'].includes(data.result.verdict) ? 'danger' : 'warning'}>{data.result.verdict}</Badge>
            </div>
            <div className="qr-box">
              <img src={data.qr} alt="Digital ID QR code" width={240} height={240} />
            </div>
            <p className="mono small break">{data.idHash}</p>
            <div className="row">
              <a href={data.qr} download="toursafe-digital-id.png" className="btn btn-ghost btn-small">Download QR</a>
              <button className="btn btn-ghost btn-small" onClick={copy}>{copied ? 'Copied' : 'Copy ID'}</button>
            </div>
          </Card>
          <Card title="Verification status" actions={<Badge tone={CHAIN_INFO[data.chainStatus]?.tone}>{CHAIN_INFO[data.chainStatus]?.label || data.chainStatus}</Badge>}>
            <CheckList result={data.result} />
            {data.idTxHash && <p className="small">Registration transaction: <span className="mono break">{data.idTxHash}</span></p>}
            {data.chainStatus !== 'confirmed' && <p className="notice notice-info small">Your ID becomes VALID once its blockchain registration is confirmed. This is retried automatically.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
