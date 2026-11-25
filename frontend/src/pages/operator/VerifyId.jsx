// ID verification: scan (camera or image file) or type a Digital ID, verify it against MongoDB + blockchain,
// revoke it with a reason, and see the revocation history.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QrScanner from '../../components/QrScanner';
import CheckList from '../../components/CheckList';
import { api } from '../../api';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Spinner, useAsync, useConfirm, useLoad, useToast } from '../../components/ui';
import { CHAIN_INFO, formatDate, formatDateTime, shortHash } from '../../utils';

const normalize = (text) => text.trim().replace(/^TSID:/i, '').toLowerCase();

export default function VerifyId() {
  const [params] = useSearchParams();
  const toast = useToast();
  const confirm = useConfirm();
  const [input, setInput] = useState(params.get('id') || '');
  const [idHash, setIdHash] = useState('');
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const { busy, error, run, setError } = useAsync();
  const revocations = useLoad(() => api('/verify/revocations'), []);

  async function verify(text) {
    const hash = normalize(text);
    setInput(hash);
    setResult(null);
    if (!/^0x[0-9a-f]{64}$/.test(hash)) {
      setError(new Error('This is not a TourSafe Digital ID (expected TSID:0x followed by 64 hex characters).'));
      return;
    }
    setIdHash(hash);
    try {
      setResult(await run(() => api(`/verify/id/${encodeURIComponent(hash)}`)));
    } catch {
      /* shown */
    }
  }

  // ?id=... from the tourist detail page
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (params.get('id')) verify(params.get('id')); }, []);

  async function revoke() {
    const reason = await confirm({
      title: `Revoke the Digital ID of ${result.tourist.name}?`,
      message: 'The revocation is written to the blockchain and cannot be undone.',
      confirmText: 'Revoke ID',
      tone: 'danger',
      input: { label: 'Reason', placeholder: 'e.g. Document fraud, trip cancelled', required: true, minLength: 3 },
    });
    if (!reason) return;
    try {
      const r = await run(() => api(`/verify/id/${idHash}/revoke`, { method: 'POST', body: { reason } }));
      setResult(r);
      revocations.reload();
      if (r.revocation.chainStatus === 'confirmed') toast('Revocation confirmed on the blockchain', { tone: 'success' });
      else toast(`Revoked in the database. Blockchain write ${r.revocation.chainStatus}: ${r.revocation.error || ''} It will be retried.`, { tone: 'warning', duration: 12000 });
    } catch {
      /* shown */
    }
  }

  const t = result?.tourist;
  const canRevoke = t && !['REVOKED', 'TAMPERED'].includes(result.verdict);

  return (
    <div className="page">
      <PageHeader title="Digital ID verification" />
      <div className="grid-2">
        <Card title="Scan or enter an ID">
          {scanning ? (
            <>
              <QrScanner onScan={(text) => { setScanning(false); verify(text); }} />
              <button className="btn btn-ghost btn-small" onClick={() => setScanning(false)}>Stop camera</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setScanning(true)}>Scan QR code (camera or image)</button>
          )}
          <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); verify(input); }}>
            <input className="mono" placeholder="TSID:0x… or 0x…" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Digital ID" />
            <button className="btn btn-primary" disabled={busy || !input.trim()}>Verify</button>
          </form>
          <p className="muted small">Camera scanning needs HTTPS or localhost and camera permission. "Scan an Image File" works without a camera.</p>
        </Card>
        <Card title="Result">
          {busy && <Spinner label="Checking database and blockchain…" />}
          <ErrorBox error={error} />
          {!result && !busy && !error && <EmptyState title="Nothing checked yet">Scan a QR code or paste an ID.</EmptyState>}
          {result && <CheckList result={result} />}
          {t && (
            <dl className="kv">
              <dt>Name</dt><dd>{t.name}</dd>
              <dt>Nationality</dt><dd>{t.nationality || '-'}</dd>
              <dt>Phone</dt><dd>{t.phone || '-'}</dd>
              <dt>Trip</dt><dd>{formatDate(t.tripStart)} – {formatDate(t.tripEnd)}</dd>
              <dt>Emergency</dt><dd>{t.emergencyContact?.name}, {t.emergencyContact?.phone}</dd>
              <dt>Account</dt><dd>{t.status}</dd>
            </dl>
          )}
          {canRevoke && <button className="btn btn-danger" onClick={revoke} disabled={busy}>Revoke this ID</button>}
        </Card>
      </div>
      <Card title="Revocation history">
        <ErrorBox error={revocations.error} onRetry={revocations.reload} />
        {revocations.loading && !revocations.data ? <Spinner /> : revocations.data?.revocations.length === 0 ? <EmptyState title="No revoked IDs" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Tourist</th><th>Reason</th><th>By</th><th>On chain</th><th>Tx</th></tr></thead>
              <tbody>
                {revocations.data?.revocations.map((r) => (
                  <tr key={r.touristId}>
                    <td className="small">{formatDateTime(r.revokedAt)}</td>
                    <td>{r.name}</td>
                    <td>{r.reason}</td>
                    <td>{r.revokedBy || '-'}</td>
                    <td><Badge tone={CHAIN_INFO[r.chainStatus]?.tone}>{CHAIN_INFO[r.chainStatus]?.label || r.chainStatus}</Badge></td>
                    <td className="mono small">{shortHash(r.txHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
