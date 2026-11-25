// Tourist notifications: in-app alerts and the email/SMS delivery history (with honest delivery status)
import { api } from '../../api';
import { useSocketEvent } from '../../SocketContext';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Spinner, useLoad } from '../../components/ui';
import { formatDateTime } from '../../utils';

const DELIVERY_TONE = { sent: 'success', failed: 'danger', not_configured: 'muted', skipped: 'muted' };
const DELIVERY_TEXT = { sent: 'accepted by provider', failed: 'failed', not_configured: 'provider not configured', skipped: 'skipped' };

export default function Notifications() {
  const { data, error, loading, reload } = useLoad(() => api('/tourists/me/notifications?limit=50'), []);
  useSocketEvent('alert', () => reload());

  async function markRead() {
    await api('/tourists/me/notifications/read', { method: 'POST' });
    reload();
  }

  return (
    <div className="page">
      <PageHeader title="Notifications" subtitle={data ? `${data.unread} unread` : ''} actions={data?.unread > 0 && <button className="btn btn-ghost btn-small" onClick={markRead}>Mark all as read</button>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <div className="grid-2">
          <Card title="Alerts">
            {data.alerts.length === 0 ? <EmptyState title="No alerts yet" /> : (
              <ul className="alert-list">
                {data.alerts.map((a) => (
                  <li key={a.id} className={`alert-item alert-${a.severity} ${a.readByTourist ? '' : 'unread'}`}>
                    <b>{a.title}</b>
                    <div>{a.touristMessage || a.message}</div>
                    <div className="muted small">{formatDateTime(a.timestamp)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Email & SMS deliveries">
            {data.deliveries.length === 0 ? <EmptyState title="No email or SMS notifications" /> : (
              <table className="table">
                <thead><tr><th>When</th><th>Event</th><th>Channel</th><th>To</th><th>Status</th></tr></thead>
                <tbody>
                  {data.deliveries.map((d) => (
                    <tr key={d._id}>
                      <td className="small">{formatDateTime(d.createdAt)}</td>
                      <td>{d.event}</td>
                      <td>{d.channel}</td>
                      <td className="small">{d.recipientType === 'emergency_contact' ? 'Emergency contact' : 'You'} ({d.to})</td>
                      <td><Badge tone={DELIVERY_TONE[d.status]} title={d.error}>{DELIVERY_TEXT[d.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
