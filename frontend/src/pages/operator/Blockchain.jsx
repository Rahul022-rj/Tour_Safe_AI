// Blockchain verification console: node/contract health, proof lifecycle counts, recent proofs, retry,
// and incident integrity verification by incident id.
import { useState } from 'react';
import { api, qs } from '../../api';
import CheckList from '../../components/CheckList';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Spinner, StatCard, useAsync, useLoad, useToast } from '../../components/ui';
import { CHAIN_INFO, formatDateTime, shortHash } from '../../utils';

export default function Blockchain() {
  const toast = useToast();
  const status = useLoad(() => api('/verify/chain'), []);
  const [kind, setKind] = useState('');
  const [pstatus, setPstatus] = useState('');
  const proofs = useLoad(() => api(`/verify/proofs${qs({ kind, status: pstatus })}`), [kind, pstatus]);
  const retry = useAsync();
  const verify = useAsync();
  const [incidentId, setIncidentId] = useState('');
  const [result, setResult] = useState(null);

  async function retryNow() {
    try {
      const r = await retry.run(() => api('/verify/chain/retry', { method: 'POST' }));
      toast(`${r.confirmed} proof(s) confirmed`, { tone: r.confirmed ? 'success' : 'info' });
      status.reload();
      proofs.reload();
    } catch {
      /* shown */
    }
  }
  async function checkIncident(e) {
    e.preventDefault();
    try {
      setResult(await verify.run(() => api(`/verify/incident/${incidentId.trim()}`)));
    } catch {
      setResult(null);
    }
  }

  const s = status.data;
  const count = (k, st) => s?.proofs.filter((p) => (!k || p.kind === k) && p.status === st).reduce((n, p) => n + p.count, 0) ?? 0;

  return (
    <div className="page">
      <PageHeader title="Blockchain" subtitle="TouristRegistry smart contract: Digital ID registrations, revocations and incident proofs" actions={<button className="btn btn-ghost btn-small" onClick={() => { status.reload(); proofs.reload(); }}>Refresh</button>} />
      <ErrorBox error={status.error} onRetry={status.reload} />
      {status.loading && !s ? <Spinner /> : s && (
        <>
          <div className="stats">
            <StatCard label="Node" value={s.ok ? 'Online' : 'Offline'} tone={s.ok ? 'success' : 'danger'} hint={s.ok ? `chain ${s.chainId} · block ${s.blockNumber}` : s.error} />
            <StatCard label="Confirmed proofs" value={count('', 'confirmed')} tone="success" />
            <StatCard label="Pending / submitted" value={count('', 'pending') + count('', 'submitted')} tone="warning" />
            <StatCard label="Failed (will retry)" value={count('', 'failed')} tone={count('', 'failed') ? 'danger' : 'default'} />
          </div>
          <Card title="Network">
            <dl className="kv">
              <dt>Contract</dt><dd className="mono break">{s.address || '-'}</dd>
              <dt>RPC</dt><dd className="mono">{s.rpcUrl || '-'}</dd>
              <dt>Signer</dt><dd>{s.signer || '-'}</dd>
              <dt>Persistence</dt><dd>{s.ok ? (s.persistent ? 'Persistent network' : <Badge tone="warning">Local Hardhat chain: in memory, erased on restart (development only)</Badge>) : '-'}</dd>
              <dt>ID policy</dt><dd>{s.requireChainForId ? 'A Digital ID is VALID only after its on-chain registration is confirmed' : 'IDs may be valid without the chain (not recommended)'}</dd>
            </dl>
            <button className="btn btn-primary btn-small" onClick={retryNow} disabled={retry.busy}>{retry.busy ? 'Retrying…' : 'Retry failed / pending proofs now'}</button>
            <ErrorBox error={retry.error} />
          </Card>
        </>
      )}

      <div className="grid-2">
        <Card title="Incident integrity verification">
          <form className="row" onSubmit={checkIncident}>
            <input className="mono" placeholder="Incident id (24 hex characters)" value={incidentId} onChange={(e) => setIncidentId(e.target.value)} aria-label="Incident id" />
            <button className="btn btn-primary" disabled={verify.busy || !/^[0-9a-f]{24}$/i.test(incidentId.trim())}>Verify</button>
          </form>
          <p className="muted small">Recomputes SHA-256 over the canonical incident record and compares it with every recorded proof and the contract.</p>
          {verify.busy && <Spinner />}
          <ErrorBox error={verify.error} />
          {result && <CheckList result={result} />}
        </Card>
        <Card title="Recent proofs" actions={
          <span className="row">
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option><option value="ID_REGISTER">ID register</option><option value="ID_REVOKE">ID revoke</option><option value="INCIDENT">Incident</option></select>
            <select value={pstatus} onChange={(e) => setPstatus(e.target.value)} aria-label="Status"><option value="">All statuses</option><option value="confirmed">Confirmed</option><option value="pending">Pending</option><option value="submitted">Submitted</option><option value="failed">Failed</option></select>
          </span>
        }>
          <ErrorBox error={proofs.error} onRetry={proofs.reload} />
          {proofs.loading && !proofs.data ? <Spinner /> : proofs.data?.proofs.length === 0 ? <EmptyState title="No proofs" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>When</th><th>Kind</th><th>Hash</th><th>Status</th><th>Tx / error</th></tr></thead>
                <tbody>
                  {proofs.data?.proofs.map((p) => (
                    <tr key={p._id}>
                      <td className="small">{formatDateTime(p.createdAt)}</td>
                      <td>{p.kind}</td>
                      <td className="mono small" title={p.hash}>{shortHash(p.hash)}</td>
                      <td><Badge tone={CHAIN_INFO[p.status]?.tone}>{p.status}</Badge>{p.attempts > 1 && <span className="muted small"> ×{p.attempts}</span>}</td>
                      <td className="mono small" title={p.lastError}>{p.txHash ? shortHash(p.txHash) : p.lastError ? <span className="text-danger">{p.lastError.slice(0, 60)}</span> : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
