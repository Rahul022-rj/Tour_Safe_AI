import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, operator, renderApp, tourist } from './helpers';
import { validate } from '../pages/public/Register';
import CheckList from '../components/CheckList';
import MapView from '../components/MapView';
import { ZoneLayer } from '../components/MapLayers';

describe('registration validation', () => {
  const good = {
    name: 'Asha Rao', email: 'asha@example.com', password: 'Str0ng!Pass', confirmPassword: 'Str0ng!Pass', phone: '+91 98765 43210', nationality: 'India',
    govtIdType: 'passport', govtId: 'P1234567', tripStart: new Date().toISOString().slice(0, 10), tripEnd: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
    ecName: 'Ravi', ecPhone: '9812345678', ecEmail: '', ecRelation: '', consent: true,
  };
  it('accepts a complete form', () => expect(validate(good)).toEqual({}));
  it('flags every invalid field', () => {
    const e = validate({ ...good, email: 'x', password: 'weak', confirmPassword: 'other', phone: '12', govtId: '!', ecPhone: '', consent: false, tripEnd: '2000-01-01' });
    expect(Object.keys(e).sort()).toEqual(['confirmPassword', 'consent', 'ecPhone', 'email', 'govtId', 'password', 'phone', 'tripEnd'].sort());
  });
});

describe('routing and authentication', () => {
  it('protected operator pages redirect anonymous users to login', async () => {
    mockApi({});
    renderApp('/operator/incidents');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
  });

  it('a tourist opening an operator page is sent to the tourist dashboard', async () => {
    localStorage.setItem('token', 'tourist-token');
    mockApi({
      'GET /auth/me': { body: { user: tourist } },
      'GET /zones': { body: { zones: [] } },
      'GET /incidents': { body: { incidents: [], total: 0 } },
      'GET /tourists/me/notifications': { body: { alerts: [], deliveries: [], unread: 0, total: 0 } },
    });
    renderApp('/operator');
    expect(await screen.findByRole('heading', { name: /Welcome, Asha/ })).toBeInTheDocument();
  });

  it('login validates input, shows server errors, and redirects by role', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      'POST /auth/login': ({ body }) => (body.password === 'Right!Pass1' ? { body: { token: 'tok', user: operator } } : { status: 401, body: { message: 'Invalid email or password' } }),
      'GET /admin/stats': { body: { tourists: { total: 3, activeTrips: 2, tracked: 1, online: 1, inCaution: 0, inRestricted: 0 }, incidents: { open: 0, reported: 0, assigned: 0, resolved: 4 }, alerts: { last24h: 0, unreviewedAnomalies: 0 }, blockchain: { ok: true, chainId: 31337, blockNumber: 9 }, generatedAt: new Date().toISOString() } },
      'GET /tourists': { body: { tourists: [], total: 0 } },
      'GET /tourists/alerts': { body: { alerts: [] } },
      'GET /incidents': { body: { incidents: [], total: 0 } },
      'GET /zones': { body: { zones: [] } },
    });
    renderApp('/login');
    await user.click(await screen.findByRole('button', { name: 'Log in' }));
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === '/auth/login')).toHaveLength(0); // nothing sent

    await user.type(screen.getByLabelText('Email'), 'ops@example.com');
    await user.type(screen.getByLabelText('Password'), 'Wrong!Pass1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'Right!Pass1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('heading', { name: 'Control room' })).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBe('tok');
    expect(await screen.findByText('Resolved incidents')).toBeInTheDocument(); // stats come from the API
  });

  it('logout calls the server, clears the token and returns to login', async () => {
    const user = userEvent.setup();
    localStorage.setItem('token', 'op');
    const api = mockApi({
      'GET /auth/me': { body: { user: operator } },
      'POST /auth/logout': { body: { message: 'Logged out' } },
      'GET /admin/stats': { status: 500, body: { message: 'x' } },
      'GET /tourists': { body: { tourists: [], total: 0 } },
      'GET /tourists/alerts': { body: { alerts: [] } },
      'GET /incidents': { body: { incidents: [], total: 0 } },
      'GET /zones': { body: { zones: [] } },
    });
    renderApp('/operator');
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
    expect(api.calls.some((c) => c.method === 'POST' && c.path === '/auth/logout')).toBe(true);
  });

  it('an expired session (401) logs the user out with a message', async () => {
    localStorage.setItem('token', 'old');
    mockApi({ 'GET /auth/me': { status: 401, body: { message: 'Session expired, please log in again' } } });
    renderApp('/tourist');
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBeNull();
  });
});

describe('SOS', () => {
  function sosApi(sosResponse) {
    return mockApi({
      'GET /auth/me': { body: { user: { ...tourist, lastLocation: { type: 'Point', coordinates: [78.47, 17.36] }, lastSeenAt: new Date().toISOString() } } },
      'GET /incidents': { body: { incidents: [], total: 0 } },
      'GET /geo/reverse': { body: { address: 'Charminar, Hyderabad' } },
      'POST /tourists/tracking': { body: {} },
      'POST /incidents/sos': sosResponse,
    });
  }

  it('requires a confirmation step before creating the incident', async () => {
    const user = userEvent.setup();
    localStorage.setItem('token', 't');
    const api = sosApi({ status: 201, body: { incident: { _id: 'i1', status: 'Reported' } } });
    renderApp('/tourist/sos');
    await user.click(await screen.findByRole('button', { name: 'SOS' }));
    expect(api.calls.some((c) => c.path === '/incidents/sos')).toBe(false); // not yet
    await user.type(screen.getByLabelText(/What is happening/), 'Lost');
    await user.click(screen.getByRole('button', { name: 'Yes, send SOS' }));
    expect(await screen.findByText(/The control room has your location/)).toBeInTheDocument();
    const sent = api.calls.find((c) => c.path === '/incidents/sos');
    expect(sent.body.message).toBe('Lost');
    expect(await screen.findByText('Charminar, Hyderabad')).toBeInTheDocument();
  });

  it('never claims success when the server fails', async () => {
    const user = userEvent.setup();
    localStorage.setItem('token', 't');
    sosApi({ status: 400, body: { message: 'Your location is unknown.' } });
    renderApp('/tourist/sos');
    await user.click(await screen.findByRole('button', { name: 'SOS' }));
    await user.click(screen.getByRole('button', { name: 'Yes, send SOS' }));
    expect(await screen.findByText('Your location is unknown.')).toBeInTheDocument();
    expect(screen.queryByText(/SOS sent/)).toBeNull();
  });

  it('reports duplicate presses honestly', async () => {
    const user = userEvent.setup();
    localStorage.setItem('token', 't');
    sosApi({ status: 200, body: { duplicate: true, retryAfterSeconds: 20, message: 'SOS already sent, help is on the way.' } });
    renderApp('/tourist/sos');
    await user.click(await screen.findByRole('button', { name: 'SOS' }));
    await user.click(screen.getByRole('button', { name: 'Yes, send SOS' }));
    expect(await screen.findByText('SOS already sent, help is on the way.')).toBeInTheDocument();
  });
});

describe('offline SOS queue', () => {
  it('queues the SOS when offline and delivers it when the connection returns', async () => {
    const user = userEvent.setup();
    localStorage.setItem('token', 't');
    let online = false;
    const api = mockApi({
      'GET /auth/me': { body: { user: { ...tourist, lastLocation: { type: 'Point', coordinates: [78.47, 17.36] }, lastSeenAt: new Date().toISOString() } } },
      'GET /incidents': { body: { incidents: [], total: 0 } },
      'GET /geo/reverse': { body: { address: null } },
      'POST /tourists/tracking': { body: {} },
      'POST /incidents/sos': () => (online ? { status: 201, body: { incident: { _id: 'i9', status: 'Reported' } } } : 'NETWORK'),
    });
    renderApp('/tourist/sos');
    await user.click(await screen.findByRole('button', { name: 'SOS' }));
    await user.click(screen.getByRole('button', { name: 'Yes, send SOS' }));
    expect(await screen.findByText(/your SOS is NOT delivered yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call 112 now' })).toHaveAttribute('href', 'tel:112');
    expect(JSON.parse(localStorage.getItem('pendingSos')).body).toBeTruthy();
    expect(screen.queryByText(/SOS sent/)).toBeNull(); // never claims delivery while offline

    online = true;
    window.dispatchEvent(new Event('online'));
    expect(await screen.findByText('Your queued SOS has now been delivered to the control room.')).toBeInTheDocument();
    expect(localStorage.getItem('pendingSos')).toBeNull();
    expect(api.calls.filter((c) => c.path === '/incidents/sos').at(-1).body.message).toMatch(/queued offline/);
  });
});

describe('components', () => {
  it('verification results show verdict and per-check state', () => {
    render(<CheckList result={{ verdict: 'REVOKED', checks: [{ label: 'Registered on blockchain', ok: true }, { label: 'Not revoked on blockchain', ok: false }, { label: 'Chain', ok: false, unknown: true }] }} />);
    expect(screen.getByRole('status')).toHaveTextContent('REVOKED');
    const items = screen.getAllByRole('listitem');
    expect(within(items[0]).getByText('✔')).toBeInTheDocument();
    expect(within(items[1]).getByText('✘')).toBeInTheDocument();
    expect(within(items[2]).getByText('?')).toBeInTheDocument();
  });

  it('renders the map with OpenStreetMap attribution and zone polygons', async () => {
    const zones = [{ _id: 'z1', name: 'Market', type: 'yellow', geometry: { type: 'Polygon', coordinates: [[[78.47, 17.35], [78.48, 17.35], [78.48, 17.36], [78.47, 17.36], [78.47, 17.35]]] } }];
    const { container } = render(<MapView height={300}><ZoneLayer zones={zones} /></MapView>);
    await waitFor(() => expect(container.querySelector('.leaflet-container')).toBeInTheDocument());
    expect(container.textContent).toMatch(/OpenStreetMap/);
    await waitFor(() => expect(container.querySelectorAll('path.leaflet-interactive').length).toBe(1));
  });
});
