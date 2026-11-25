// Public information pages: landing, about, features, help/contact, 404
import { Link } from 'react-router-dom';
import { useAuth, homeFor } from '../../AuthContext';

const FEATURES = [
  { title: 'Live location sharing', text: 'Tourists share their device location from the browser after giving permission. Accuracy and update time are always shown; the browser may use GPS, Wi-Fi or mobile networks.' },
  { title: 'Geo-fenced safety zones', text: 'Operators draw safe (green), caution (yellow) and restricted (red) zones. Entering a caution or restricted zone raises an alert once, not on every update, and inaccurate readings are never treated as certain violations.' },
  { title: 'One-tap SOS', text: 'An SOS creates an incident with your position (or last known position), alerts the control room instantly and notifies your emergency contact when email/SMS is configured.' },
  { title: 'Incident workflow', text: 'Reported → Assigned → Resolved, with notes, full history, search, filters and protection against two operators changing the same incident at once.' },
  { title: 'Blockchain Digital ID', text: 'A salted SHA-256 fingerprint of your identity is registered on an Ethereum smart contract. Your personal data stays off-chain. A QR code lets officers verify, and detect revoked, expired or tampered IDs.' },
  { title: 'Tamper-evident incidents', text: 'Every incident state is hashed and logged on chain. Verification recomputes the hash and shows whether the record still matches its proof.' },
  { title: 'Nearby help & safer routes', text: 'Police stations and hospitals from OpenStreetMap, and walking/driving routes from OSRM ranked by the safety zones they cross. No route is ever claimed to be guaranteed safe.' },
  { title: 'Anomaly review & risk insight', text: 'Unusual movement, lost signal and long stays in restricted zones create review alerts for operators. An experimental risk model learns from recorded incidents and reports its own limitations.' },
];

export function Landing() {
  const { user } = useAuth();
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Smart tourist safety monitoring</p>
          <h1>Travel with a control room behind you.</h1>
          <p className="lead">
            TourSafe AI connects tourists and local safety operators: live location, geo-fenced safety zones,
            instant SOS, and a blockchain-verified Digital ID.
          </p>
          <div className="hero-actions">
            {user ? (
              <Link className="btn btn-primary btn-lg" to={homeFor(user)}>Open your dashboard</Link>
            ) : (
              <>
                <Link className="btn btn-primary btn-lg" to="/register">Register as a tourist</Link>
                <Link className="btn btn-ghost btn-lg" to="/login">Log in</Link>
              </>
            )}
          </div>
          <p className="muted small">TourSafe supports the authorities; it does not replace them. In an emergency, call 112 (India) or the local emergency number.</p>
        </div>
        <div className="hero-panel" aria-hidden="true">
          <div className="hero-zone z-green">Safe zone</div>
          <div className="hero-zone z-yellow">Caution</div>
          <div className="hero-zone z-red">Restricted</div>
          <div className="hero-sos">SOS</div>
        </div>
      </section>
      <section className="feature-grid">
        {FEATURES.slice(0, 4).map((f) => (
          <article key={f.title} className="card"><h3>{f.title}</h3><p>{f.text}</p></article>
        ))}
      </section>
      <p className="center"><Link to="/features">See all features →</Link></p>
    </>
  );
}

export function Features() {
  return (
    <div className="prose-page">
      <h1>Features</h1>
      <div className="feature-grid">
        {FEATURES.map((f) => (
          <article key={f.title} className="card"><h3>{f.title}</h3><p>{f.text}</p></article>
        ))}
      </div>
    </div>
  );
}

export function About() {
  return (
    <div className="prose-page card">
      <h1>About the project</h1>
      <p>
        <b>TourSafe AI: Smart Tourist Safety Monitoring and Incident Response System Using Geo-Fencing and
        Blockchain-Based Digital Identity</b> is an MCA project. It shows how a city control room could monitor
        registered tourists, warn them about unsafe areas and respond to emergencies, while giving every tourist a
        verifiable Digital ID that does not expose their personal data.
      </p>
      <h2>How it works</h2>
      <ol>
        <li><b>Register:</b> your details are stored in a MongoDB database. A random salt and a SHA-256 hash of your identity form your Digital ID; only the hash goes to the blockchain.</li>
        <li><b>Share location:</b> your browser sends your position about every 5 seconds while sharing is on. The server checks it against the safety zones with Turf.js.</li>
        <li><b>Alerts:</b> entering a caution or restricted zone alerts you and the control room in real time over Socket.IO.</li>
        <li><b>SOS:</b> creates an incident immediately. Blockchain logging happens afterwards and never delays help.</li>
        <li><b>Verify:</b> officers scan your QR code; the system recomputes your hash and checks the smart contract.</li>
      </ol>
      <h2>Technology</h2>
      <p>React 18 + Vite, Leaflet, Node.js + Express 5, MongoDB + Mongoose, Socket.IO, Turf.js, Solidity + Hardhat + ethers.js v6, OpenStreetMap (tiles, Overpass, Nominatim) and OSRM routing.</p>
      <h2>Limitations</h2>
      <ul>
        <li>Browser location accuracy depends on the device; indoor and desktop locations can be off by hundreds of metres.</li>
        <li>The development blockchain (Hardhat) runs in memory and is reset when it restarts.</li>
        <li>Map data comes from OpenStreetMap and is not officially verified.</li>
        <li>The risk model is experimental and only learns from incidents recorded in this system.</li>
      </ul>
    </div>
  );
}

export function Help() {
  return (
    <div className="prose-page card">
      <h1>Help &amp; contact</h1>
      <div className="notice notice-danger">
        <b>Emergency?</b> Call <a href="tel:112">112</a> (India national emergency number) or the local emergency number first. If you are logged in, press SOS as well.
      </div>
      <h2>Common questions</h2>
      <dl className="faq">
        <dt>My location does not work.</dt>
        <dd>Allow location for this site (padlock icon in the address bar), make sure your device's location service is on, and use HTTPS or localhost. Desktop computers without GPS may only get an approximate location.</dd>
        <dt>My Digital ID says "pending".</dt>
        <dd>The blockchain registration is still being confirmed. It is retried automatically; check again in a minute.</dd>
        <dt>I forgot my password.</dt>
        <dd>Use <Link to="/forgot-password">Forgot password</Link>. A single-use link valid for 30 minutes is emailed to you (requires the operator to have configured email).</dd>
        <dt>Can I change my name or passport number?</dt>
        <dd>No. These are part of your Digital ID fingerprint. Contact the tourist help desk to re-issue your ID.</dd>
        <dt>Who can see my location?</dt>
        <dd>Only you and the control-room operators, and only while you share it. History is deleted automatically after the retention period configured by the operator (30 days by default).</dd>
      </dl>
      <h2>Contact</h2>
      <p>For account or Digital ID problems, contact the tourist help desk of the authority running this TourSafe installation.</p>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="prose-page card center">
      <h1>Page not found</h1>
      <p>The page you asked for does not exist.</p>
      <Link className="btn btn-primary" to="/">Go to the home page</Link>
    </div>
  );
}
