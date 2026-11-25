import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '../AuthContext';
import { SocketProvider } from '../SocketContext';
import { ConfirmProvider, ToastProvider } from '../components/ui';
import { AppRoutes } from '../App';

// Mock fetch with a route table: { 'GET /auth/me': {status, body} | (req) => {status, body} }
export function mockApi(routes) {
  const calls = [];
  const fetchMock = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = String(url).replace(/^\/api/, '').split('?')[0];
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, path, body, url: String(url) });
    let r = routes[`${method} ${path}`];
    if (typeof r === 'function') r = r({ body, url: String(url) });
    if (r === 'NETWORK') throw new TypeError('Failed to fetch'); // simulates being offline
    if (!r) r = { status: 404, body: { message: `no mock for ${method} ${path}` } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <SocketProvider>
              <AppRoutes />
            </SocketProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

const day = 864e5;
export const tourist = {
  _id: 't1', name: 'Asha Rao', email: 'asha@example.com', role: 'tourist', status: 'active', nationality: 'India',
  tripStart: new Date(Date.now() - day).toISOString(), tripEnd: new Date(Date.now() + 5 * day).toISOString(),
  emergencyContact: { name: 'Ravi', phone: '+919812345678' }, idChainStatus: 'confirmed', lastZoneType: 'none',
};
export const operator = { _id: 'a1', name: 'Ops', email: 'ops@example.com', role: 'admin', status: 'active' };
