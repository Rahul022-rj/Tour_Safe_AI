// Three layouts: public pages, the tourist app, and the operator console.
import { useEffect, useState } from 'react';
import { useSocketEvent } from '../SocketContext';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, homeFor } from '../AuthContext';
import { useSocketStatus } from '../SocketContext';
import { useOnline } from '../hooks';
import { TrackingProvider, useTracking } from '../tracking/TrackingContext';
import { Badge, useConfirm } from '../components/ui';
import { PendingSosSender } from '../pages/tourist/Sos';

function Brand({ to = '/' }) {
  return (
    <Link to={to} className="brand" aria-label="TourSafe AI home">
      <span className="brand-mark" aria-hidden="true">TS</span>
      <span>TourSafe <b>AI</b></span>
    </Link>
  );
}

// ---------------- Public ----------------
export function PublicLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <div className="public">
      <header className="public-header">
        <Brand />
        <button className="menu-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
        <nav className={`public-nav ${open ? 'open' : ''}`}>
          <NavLink to="/features">Features</NavLink>
          <NavLink to="/about">About</NavLink>
          <NavLink to="/help">Help &amp; contact</NavLink>
          {user ? (
            <Link className="btn btn-primary btn-small" to={homeFor(user)}>Open dashboard</Link>
          ) : (
            <>
              <NavLink to="/login">Log in</NavLink>
              <Link className="btn btn-primary btn-small" to="/register">Register</Link>
            </>
          )}
        </nav>
      </header>
      <main className="public-main">
        <Outlet />
      </main>
      <footer className="public-footer">
        <span>TourSafe AI · MCA project: smart tourist safety monitoring with geo-fencing and blockchain digital ID</span>
        <span>In an emergency always call the local emergency number (112 in India).</span>
      </footer>
    </div>
  );
}

// ---------------- App shell (tourist + operator) ----------------
function ConnectionBadges() {
  const status = useSocketStatus();
  const online = useOnline();
  if (!online) return <Badge tone="danger" title="Your device is offline">offline</Badge>;
  const tone = status === 'live' ? 'success' : status === 'offline' ? 'muted' : 'warning';
  return <Badge tone={tone} title="Real-time connection (Socket.IO)">{status === 'live' ? 'live' : status}</Badge>;
}

function Shell({ nav, extra, children }) {
  const { user, logout } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  async function handleLogout() {
    if (user.role === 'tourist' && !(await confirm({ title: 'Log out?', message: 'Location sharing will stop when you log out.', confirmText: 'Log out' }))) return;
    await logout();
    navigate('/login');
  }

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Main navigation">
        <Brand to={homeFor(user)} />
        <nav>
          {nav.map((item) =>
            item.section ? (
              <div key={item.section} className="nav-section">{item.section}</div>
            ) : (
              <NavLink key={item.to} to={item.to} end={item.end}>
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          )}
        </nav>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <button className="menu-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}>☰</button>
          <div className="topbar-extra">{extra}</div>
          <div className="topbar-right">
            <ConnectionBadges />
            <span className="user-chip" title={user.email}>
              {user.name} <Badge tone={user.role === 'admin' ? 'warning' : 'info'}>{user.role === 'admin' ? 'operator' : 'tourist'}</Badge>
            </span>
            <button className="btn btn-ghost btn-small" onClick={handleLogout}>Log out</button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
      {open && <div className="nav-scrim" onClick={() => setOpen(false)} />}
    </div>
  );
}

const TOURIST_NAV = [
  { to: '/tourist', label: 'Dashboard', icon: '⌂', end: true },
  { to: '/tourist/map', label: 'Live map & routes', icon: '◎' },
  { to: '/tourist/sos', label: 'Emergency SOS', icon: '!' },
  { to: '/tourist/safety', label: 'Safety tools', icon: '◷' },
  { to: '/tourist/id', label: 'Digital ID', icon: '▣' },
  { to: '/tourist/incidents', label: 'My incidents', icon: '≡' },
  { to: '/tourist/notifications', label: 'Notifications', icon: '✉' },
  { to: '/tourist/profile', label: 'Profile & settings', icon: '☺' },
];

function TrackingIndicator() {
  const t = useTracking();
  const tone = t.status === 'active' ? 'success' : ['denied', 'insecure', 'unsupported', 'unavailable'].includes(t.status) ? 'danger' : t.status === 'idle' ? 'muted' : 'warning';
  return (
    <Link to="/tourist/map" className="tracking-pill">
      <Badge tone={tone}>{t.status === 'active' ? '● Sharing location' : t.status === 'idle' ? 'Location off' : t.status}</Badge>
    </Link>
  );
}

// Refreshes the logged-in tourist's record when the server reports a Digital ID change, and once on load
function UserRefresher() {
  const { refreshUser } = useAuth();
  useEffect(() => {
    refreshUser().catch(() => {});
  }, [refreshUser]);
  useSocketEvent('alert', (a) => {
    if (['ID_STATUS', 'ID_REVOKED'].includes(a.kind)) refreshUser().catch(() => {});
  });
  return null;
}

export function TouristLayout() {
  return (
    <TrackingProvider>
      <PendingSosSender />
      <UserRefresher />
      <Shell
        nav={TOURIST_NAV}
        extra={
          <>
            <TrackingIndicator />
            <Link to="/tourist/sos" className="btn btn-sos-mini" aria-label="Emergency SOS">SOS</Link>
          </>
        }
      >
        <Outlet />
      </Shell>
    </TrackingProvider>
  );
}

const OPERATOR_NAV = [
  { to: '/operator', label: 'Dashboard', icon: '⌂', end: true },
  { to: '/operator/monitor', label: 'Live monitoring', icon: '◎' },
  { to: '/operator/incidents', label: 'Incidents', icon: '!' },
  { to: '/operator/zones', label: 'Zone manager', icon: '⬡' },
  { to: '/operator/tourists', label: 'Tourists', icon: '☺' },
  { to: '/operator/safety', label: 'Safety & advisories', icon: '◷' },
  { section: 'Verification' },
  { to: '/operator/verify', label: 'ID verification', icon: '▣' },
  { to: '/operator/blockchain', label: 'Blockchain', icon: '⛓' },
  { section: 'Administration' },
  { to: '/operator/reports', label: 'Reports & logs', icon: '≡' },
  { to: '/operator/settings', label: 'Settings', icon: '⚙' },
];

export function OperatorLayout() {
  return (
    <Shell nav={OPERATOR_NAV} extra={<span className="muted small">Control room</span>}>
      <Outlet />
    </Shell>
  );
}
