// Unit tests for pure functions (no database, no network). Run: npm test --prefix backend
process.env.NODE_ENV = 'test';
process.env.TOURSAFE_SKIP_ENV_FILE = '1';
const test = require('node:test');
const assert = require('node:assert/strict');

const v = require('../utils/validate');
const { canonicalStringify } = require('../utils/canonical');
const { computeIncidentHash } = require('../utils/incidentHash');
const { computeIdHash, createSalt } = require('../utils/digitalId');
const geofence = require('../services/geofence');
const anomaly = require('../services/anomaly');
const { routeZoneHits, rankRoutes, fromOverpass } = require('../services/geo');
const risk = require('../services/risk');
const { stripOperators } = require('../middleware/security');
const { plan } = require('../services/notify');
const { liveStatus } = require('../routes/tourist');
const { mask, dateRange } = require('../utils/http');

const square = (lng, lat, d) => ({ type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] });

test('coordinate validation rejects strings, NaN and out-of-range values', () => {
  assert.equal(v.isValidLatLng(17.38, 78.48), true);
  assert.equal(v.isValidLatLng('17.38', 78.48), false);
  assert.equal(v.isValidLatLng(NaN, 0), false);
  assert.equal(v.isValidLatLng(91, 0), false);
  assert.equal(v.isValidLatLng(0, -181), false);
  assert.equal(v.isValidLatLng(-90, 180), true);
});

test('password policy', () => {
  assert.deepEqual(v.passwordProblems('Str0ng!Pass'), []);
  assert.ok(v.passwordProblems('short').length > 0);
  assert.ok(v.passwordProblems('alllowercase1!').includes('an upper-case letter'));
  assert.ok(v.passwordProblems('NoSymbol123').includes('a symbol'));
  assert.deepEqual(v.passwordProblems(undefined), ['Password is required']);
});

test('registration validation reports each bad field', () => {
  const { errors } = v.validateRegistration({ name: 'A', email: 'bad', password: 'x', confirmPassword: 'y', phone: '12', govtId: '!', tripStart: '2030-01-05', tripEnd: '2030-01-01', emergencyContact: {} });
  for (const f of ['name', 'email', 'password', 'confirmPassword', 'phone', 'nationality', 'govtId', 'tripEnd', 'emergencyContact.name', 'emergencyContact.phone']) {
    assert.ok(errors[f], `expected error for ${f}`);
  }
  const ok = v.validateRegistration({
    name: 'Asha Rao', email: 'Asha@Example.com', password: 'Str0ng!Pass', confirmPassword: 'Str0ng!Pass', phone: '+91 98765-43210',
    nationality: 'India', govtId: 'P1234567', tripStart: new Date().toISOString(), tripEnd: new Date(Date.now() + 864e5).toISOString(),
    emergencyContact: { name: 'Ravi', phone: '9812345678' },
  });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.email, 'asha@example.com');
  assert.equal(ok.value.phone, '+919876543210');
});

test('polygon validation', () => {
  assert.equal(v.polygonProblems(square(78, 17, 0.01)), null);
  assert.match(v.polygonProblems({ type: 'Point', coordinates: [1, 2] }), /Polygon/);
  assert.match(v.polygonProblems({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 2]]] }), /closed/);
  assert.match(v.polygonProblems({ type: 'Polygon', coordinates: [[[0, 0], [200, 0], [1, 1], [0, 0]]] }), /range/);
  // bow-tie: edges cross
  const bowtie = { type: 'Polygon', coordinates: [[[78, 17], [78.01, 17.01], [78.01, 17], [78, 17.01], [78, 17]]] };
  assert.match(geofence.geometryProblem(bowtie), /cross/);
  assert.equal(geofence.geometryProblem(square(78, 17, 0.01)), null);
});

test('canonical JSON is independent of key order and normalises dates/-0/undefined', () => {
  const d = new Date('2026-01-01T00:00:00Z');
  assert.equal(canonicalStringify({ b: 1, a: [1, undefined], c: undefined, d }), canonicalStringify({ d, a: [1, null], b: 1 }));
  assert.equal(canonicalStringify({ x: -0 }), '{"x":0}');
  assert.throws(() => canonicalStringify({ x: Infinity }));
});

test('incident hash is deterministic and changes when the record changes', () => {
  const base = {
    _id: '65a000000000000000000001', touristId: '65a000000000000000000002', type: 'SOS', message: 'help',
    location: { coordinates: [78.4747, 17.3616] }, status: 'Reported', revision: 0,
    history: [{ status: 'Reported', by: '65a000000000000000000002', at: new Date('2026-01-01T10:00:00Z') }],
    createdAt: new Date('2026-01-01T10:00:00Z'), updatedAt: new Date(), chainHash: '0xabc',
  };
  const h1 = computeIncidentHash(base);
  assert.match(h1, /^0x[0-9a-f]{64}$/);
  // reordered keys, a different updatedAt and chain fields do not change the hash
  const reordered = { ...Object.fromEntries(Object.entries(base).reverse()), updatedAt: new Date(0), chainTxHash: '0x1' };
  assert.equal(computeIncidentHash(reordered), h1);
  // tiny float formatting difference (below 1e-7 deg) does not change it either
  assert.equal(computeIncidentHash({ ...base, location: { coordinates: [78.47470000000001, 17.3616] } }), h1);
  assert.notEqual(computeIncidentHash({ ...base, message: 'help!' }), h1);
  assert.notEqual(computeIncidentHash({ ...base, status: 'Assigned' }), h1);
});

test('Digital ID hash depends on details and salt', () => {
  const u = { name: 'A B', email: 'a@b.com', govtId: 'P1', tripStart: '2026-01-01', tripEnd: '2026-01-05' };
  const salt = createSalt();
  assert.equal(computeIdHash(u, salt), computeIdHash({ ...u, email: 'A@B.COM' }, salt));
  assert.notEqual(computeIdHash(u, salt), computeIdHash({ ...u, govtId: 'P2' }, salt));
  assert.notEqual(computeIdHash(u, salt), computeIdHash(u, createSalt()));
});

test('geofence: highest-risk zone wins when polygons overlap', () => {
  const zones = [
    { _id: 'g', type: 'green', geometry: square(78, 17, 0.02) },
    { _id: 'y', type: 'yellow', geometry: square(78, 17, 0.01) },
    { _id: 'r', type: 'red', geometry: square(78.005, 17, 0.003) },
  ];
  assert.equal(geofence.findZone([78, 17], zones)._id, 'y');
  assert.equal(geofence.findZone([78.005, 17], zones)._id, 'r');
  assert.equal(geofence.findZone([78.015, 17], zones)._id, 'g');
  assert.equal(geofence.findZone([79, 17], zones), null);
});

test('geofence: accuracy-aware confidence', () => {
  const zones = [{ _id: 'r', type: 'red', geometry: square(78, 17, 0.01) }]; // ~1.1 km half-width
  assert.equal(geofence.classify([78, 17], zones, 20).confidence, 'high'); // centre, accurate
  assert.equal(geofence.classify([78, 17], zones, undefined).confidence, 'high'); // no accuracy reported
  assert.equal(geofence.classify([78, 17], zones, 500).confidence, 'uncertain'); // worse than 100 m
  assert.equal(geofence.classify([78.0099, 17], zones, 50).confidence, 'uncertain'); // ~10 m from edge
  assert.equal(geofence.classify([78.0101, 17], zones, 50).confidence, 'uncertain'); // just outside, near edge
  assert.equal(geofence.classify([78.02, 17], zones, 50).confidence, 'high'); // clearly outside
});

test('geofence: alerts only on confident entry into a new yellow/red zone', () => {
  const red = { _id: 'r1', type: 'red' };
  assert.equal(geofence.shouldAlert(null, red), true);
  assert.equal(geofence.shouldAlert('r1', red), false); // same zone
  assert.equal(geofence.shouldAlert(null, { _id: 'g', type: 'green' }), false);
  assert.equal(geofence.shouldAlert(null, null), false);
  assert.equal(geofence.shouldAlert(null, red, 'uncertain'), false);
});

test('anomaly: implausible speed needs accurate readings', () => {
  const a = { lat: 17, lng: 78, at: new Date('2026-01-01T10:00:00Z'), accuracy: 10 };
  const farFast = { lat: 17.5, lng: 78, at: new Date('2026-01-01T10:00:10Z'), accuracy: 10 }; // 55 km in 10 s
  const walk = { lat: 17.0001, lng: 78, at: new Date('2026-01-01T10:00:10Z'), accuracy: 10 };
  assert.equal(anomaly.isImplausibleJump(a, farFast), true);
  assert.equal(anomaly.isImplausibleJump(a, walk), false);
  assert.equal(anomaly.isImplausibleJump(a, { ...farFast, accuracy: 900 }), false); // noisy fix ignored
  assert.equal(anomaly.isImplausibleJump(null, walk), false);
});

test('routing: zone hits and safest-first ranking', () => {
  const zones = [{ _id: 'r', name: 'Red', type: 'red', geometry: square(78.01, 17, 0.002) }, { _id: 'g', name: 'G', type: 'green', geometry: square(78, 17, 0.1) }];
  const through = { type: 'LineString', coordinates: [[78, 17], [78.02, 17]] };
  const around = { type: 'LineString', coordinates: [[78, 17], [78.01, 17.01], [78.02, 17]] };
  assert.deepEqual(routeZoneHits(through, zones).map((z) => z.name), ['Red']); // green ignored
  assert.deepEqual(routeZoneHits(around, zones), []);
  const ranked = rankRoutes([
    { index: 0, durationS: 100, zones: [{ type: 'red' }] },
    { index: 1, durationS: 300, zones: [] },
    { index: 2, durationS: 200, zones: [{ type: 'yellow' }] },
  ]);
  assert.deepEqual(ranked.map((r) => r.index), [1, 2, 0]);
});

test('places: Overpass elements are labelled as unverified OpenStreetMap data', () => {
  const p = fromOverpass({ type: 'node', id: 5, lat: 17.3, lon: 78.4, tags: { name: 'X Police', phone: '100' } }, 'police');
  assert.equal(p.source, 'openstreetmap');
  assert.equal(p.verified, false);
  assert.deepEqual(p.location.coordinates, [78.4, 17.3]); // GeoJSON [lng, lat]
  assert.equal(fromOverpass({ type: 'way', id: 1, tags: {} }, 'police'), null);
});

test('risk: decision tree learns a separable pattern and evaluates honestly', () => {
  const rows = [];
  for (let i = 0; i < 200; i++) {
    const zoneLevel = i % 4;
    rows.push({ x: { zoneLevel, hourBucket: i % 8, dayOfWeek: i % 7, weekend: 0, priorIncidents: 0, prior30d: 0 }, y: zoneLevel === 3 ? 1 : 0 });
  }
  const tree = risk.trainTree(rows.slice(0, 140));
  const m = risk.evaluate(tree, rows.slice(140));
  assert.equal(m.recall, 1);
  assert.equal(m.precision, 1);
  assert.equal(m.confusionMatrix.tp + m.confusionMatrix.fp + m.confusionMatrix.tn + m.confusionMatrix.fn, 60);
});

test('risk: dataset features never use the future (no leakage)', () => {
  const zones = [];
  const t0 = new Date('2026-03-02T09:00:00');
  const incidents = [{ location: { coordinates: [78.475, 17.365] }, createdAt: new Date(t0.getTime() + 3600e3) }];
  const presence = [{ cell: risk.cellOf(17.365, 78.475), start: risk.windowStart(t0) }];
  const rows = risk.buildDataset(presence, incidents, zones);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].y, 1);
  assert.equal(rows[0].x.priorIncidents, 0); // the incident itself is not a "prior" feature
});

test('security: Mongo operators are stripped from input', () => {
  const body = stripOperators({ email: { $gt: '' }, nested: { 'a.b': 1, ok: 2 }, list: [{ $where: 'x' }] });
  assert.deepEqual(body, { email: {}, nested: { ok: 2 }, list: [{}] });
});

test('notifications: plan respects preferences and event type', () => {
  const user = { _id: 'u', name: 'T', email: 't@x.com', phone: '+911234567', emergencyContact: { phone: '+919999999', email: 'e@x.com' }, notificationPrefs: { email: true, sms: false, notifyEmergencyContact: true } };
  const sos = plan('SOS', user, { lat: 17, lng: 78 });
  assert.ok(sos.some((m) => m.recipientType === 'emergency_contact' && m.channel === 'sms'));
  assert.ok(sos.every((m) => !(m.recipientType === 'tourist' && m.channel === 'sms'))); // tourist opted out of SMS
  assert.equal(plan('ZONE_YELLOW', user, { zoneName: 'Z' }).length, 1);
  assert.equal(plan('ZONE_RED', { ...user, notificationPrefs: { notifyEmergencyContact: false } }, { zoneName: 'Z' }).some((m) => m.recipientType === 'emergency_contact'), false);
});

test('live status precedence', () => {
  const now = Date.now();
  const t = { _id: 'a', lastSeenAt: new Date(now - 1000), lastLocation: { coordinates: [78, 17] }, lastZoneType: 'red', trackingActive: true };
  assert.equal(liveStatus(t, new Set(), now), 'restricted');
  assert.equal(liveStatus(t, new Set(['a']), now), 'sos');
  assert.equal(liveStatus({ ...t, lastSeenAt: new Date(now - 120000) }, new Set(), now), 'stale');
  assert.equal(liveStatus({ ...t, lastSeenAt: new Date(now - 3600e3) }, new Set(), now), 'offline');
  assert.equal(liveStatus({ ...t, trackingActive: false }, new Set(), now), 'offline'); // stopped sharing
  assert.equal(liveStatus({ _id: 'b' }, new Set(), now), 'no_data');
});

test('helpers: masking and date ranges', () => {
  assert.equal(mask('+919876543210'), '+91******3210');
  assert.equal(mask('person@example.com'), 'pe***@example.com');
  const r = dateRange({ from: '2026-01-01', to: '2026-01-31' });
  assert.equal(r.$lte.toISOString(), '2026-01-31T23:59:59.999Z');
  assert.equal(dateRange({ from: 'nonsense' }), undefined);
});
