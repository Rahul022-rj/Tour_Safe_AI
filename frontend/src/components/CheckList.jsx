// Shows a verification result: a big verdict plus a tick/cross (or "?" when it could not be checked) per check.
// Used for Digital ID verification and for the incident integrity check.
const GOOD = ['VALID', 'INTACT'];
const WARN = ['PENDING', 'NOT ON BLOCKCHAIN', 'NOT SUBMITTED', 'NOT CONFIRMED', 'BLOCKCHAIN UNAVAILABLE', 'PROOF UNAVAILABLE', 'EXPIRED'];

export default function CheckList({ result }) {
  const tone = GOOD.includes(result.verdict) ? 'ok' : WARN.includes(result.verdict) ? 'warn' : 'bad';
  return (
    <div>
      <div className={`verdict verdict-${tone}`} role="status">{result.verdict}</div>
      {result.chainNote && <p className="notice notice-warning">{result.chainNote}</p>}
      {result.pendingNote && <p className="notice notice-info">{result.pendingNote}</p>}
      <ul className="checks">
        {result.checks.map((c) => (
          <li key={c.label} className={c.unknown ? 'check-unknown' : c.ok ? 'check-ok' : 'check-bad'}>
            <span className="check-icon" aria-hidden="true">{c.unknown ? '?' : c.ok ? '✔' : '✘'}</span>
            <div>
              {c.label}
              <span className="sr-only">: {c.unknown ? 'could not be checked' : c.ok ? 'passed' : 'failed'}</span>
              {c.detail && <div className="check-detail">{c.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
      {result.checkedAt && <p className="muted small">Checked {new Date(result.checkedAt).toLocaleString()}</p>}
    </div>
  );
}
