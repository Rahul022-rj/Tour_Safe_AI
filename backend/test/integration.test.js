// End-to-end API tests against a real MongoDB database, a real Hardhat blockchain and real Socket.IO.
// Covers the 10 acceptance workflows (TEST 1-10) plus authentication, authorization and validation.
// Run: npm test --prefix backend   (MongoDB must be running; the contract must be compiled)
const h = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

const { describe, before, after, it } = test;
const CHARMINAR = { lat: 17.3616, lng: 78.4747 };

describe('TourSafe API', { concurrency: false }, () => {
  let admin; // { token, user }
  let adminSocket;
  const zones = {};

  before(async () => {
    await h.startChain();
    await h.startServer();
    admin = await h.createAdmin();
    adminSocket = await h.connectSocket(admin.token);
    // Zones around Charminar: a yellow caution square with a red restricted square inside its east part
    const yellow = await h.api().post('/api/zones').set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Test Caution', type: 'yellow', description: 'Crowded', geometry: h.square(CHARMINAR.lng, CHARMINAR.lat, 0.01) });
    assert.equal(yellow.status, 201, JSON.stringify(yellow.body));
    zones.yellow = yellow.body.zone;
    const red = await h.api().post('/api/zones').set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Test Restricted', type: 'red', geometry: h.square(CHARMINAR.lng + 0.03, CHARMINAR.lat, 0.005) });
    assert.equal(red.status, 201);
    zones.red = red.body.zone;
  });

  after(async () => {
    adminSocket?.close();
    await h.stopServer();
    await h.stopChain();
  });

  // ---------------- Authentication ----------------
  describe('authentication', () => {
    it('rejects invalid registrations with field errors', async () => {
      const res = await h.api().post('/api/auth/register').send(h.touristBody({ email: 'not-an-email', password: 'weak', confirmPassword: 'other', phone: 'abc' }));
      assert.equal(res.status, 400);
      for (const f of ['email', 'password', 'confirmPassword', 'phone']) assert.ok(res.body.errors[f], f);
    });

    it('never allows registering as an operator', async () => {
      const res = await h.api().post('/api/auth/register').send(h.touristBody({ role: 'admin' }));
      assert.equal(res.status, 201);
      assert.equal(res.body.user.role, 'tourist');
    });

    it('prevents duplicate accounts and never returns password data', async () => {
      const body = h.touristBody();
      const first = await h.api().post('/api/auth/register').send(body);
      assert.equal(first.status, 201);
      assert.equal(first.body.user.passwordHash, undefined);
      assert.equal(first.body.user.salt, undefined);
      const dup = await h.api().post('/api/auth/register').send({ ...body, govtId: 'P7777777' });
      assert.equal(dup.status, 409);
    });

    it('login: wrong password and unknown account give the same 401; NoSQL injection is blocked', async () => {
      const t = await h.registerTourist();
      const wrong = await h.api().post('/api/auth/login').send({ email: t.user.email, password: 'Wrong!Pass1' });
      const unknown = await h.api().post('/api/auth/login').send({ email: 'nobody@example.com', password: 'Wrong!Pass1' });
      assert.equal(wrong.status, 401);
      assert.equal(unknown.status, 401);
      assert.equal(wrong.body.message, unknown.body.message);
      const inj = await h.api().post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
      assert.equal(inj.status, 400);
    });

    it('rejects missing, forged and expired tokens', async () => {
      assert.equal((await h.api().get('/api/auth/me')).status, 401);
      assert.equal((await h.api().get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi')).status, 401);
      const jwt = require('jsonwebtoken');
      const expired = jwt.sign({ id: admin.user._id, role: 'admin', tv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET);
      const res = await h.api().get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
      assert.equal(res.status, 401);
      assert.equal(res.body.code, 'TOKEN_EXPIRED');
    });

    it('password change invalidates old tokens; forgot/reset uses a single-use token', async () => {
      const t = await h.registerTourist();
      const changed = await h.api().post('/api/auth/change-password').set('Authorization', `Bearer ${t.token}`)
        .send({ currentPassword: 'Str0ng!Pass', newPassword: 'N3w!Password', confirmPassword: 'N3w!Password' });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
      assert.equal((await h.api().get('/api/auth/me').set('Authorization', `Bearer ${t.token}`)).status, 401); // old token dead
      assert.equal((await h.api().get('/api/auth/me').set('Authorization', `Bearer ${changed.body.token}`)).status, 200);

      // forgot: same answer for known and unknown emails
      const known = await h.api().post('/api/auth/forgot-password').send({ email: t.user.email });
      const unknown = await h.api().post('/api/auth/forgot-password').send({ email: 'nobody@example.com' });
      assert.equal(known.status, 200);
      assert.deepEqual(known.body, unknown.body);
      // Reset with a token we plant (the real one is only ever emailed)
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const User = require('../models/User');
      await User.updateOne({ _id: t.user._id }, { resetTokenHash: crypto.createHash('sha256').update(token).digest('hex'), resetTokenExpires: new Date(Date.now() + 60000) });
      const reset = await h.api().post('/api/auth/reset-password').send({ email: t.user.email, token, newPassword: 'R3set!Password', confirmPassword: 'R3set!Password' });
      assert.equal(reset.status, 200, JSON.stringify(reset.body));
      const reuse = await h.api().post('/api/auth/reset-password').send({ email: t.user.email, token, newPassword: 'An0ther!Pass', confirmPassword: 'An0ther!Pass' });
      assert.equal(reuse.status, 400); // single use
      assert.equal((await h.api().post('/api/auth/login').send({ email: t.user.email, password: 'R3set!Password' })).status, 200);

      // expired token
      const t2 = crypto.randomBytes(32).toString('hex');
      await User.updateOne({ _id: t.user._id }, { resetTokenHash: crypto.createHash('sha256').update(t2).digest('hex'), resetTokenExpires: new Date(Date.now() - 1000) });
      assert.equal((await h.api().post('/api/auth/reset-password').send({ email: t.user.email, token: t2, newPassword: 'An0ther!Pass' })).status, 400);
    });

    it('suspended accounts cannot log in or use existing tokens', async () => {
      const t = await h.registerTourist();
      const res = await h.api().patch(`/api/tourists/${t.user._id}/status`).set('Authorization', `Bearer ${admin.token}`).send({ status: 'suspended' });
      assert.equal(res.status, 200);
      assert.equal((await h.api().get('/api/auth/me').set('Authorization', `Bearer ${t.token}`)).status, 401);
      const login = await h.api().post('/api/auth/login').send({ email: t.user.email, password: 'Str0ng!Pass' });
      assert.equal(login.status, 403);
    });

    it('profile edit cannot change identity fields', async () => {
      const t = await h.registerTourist();
      const bad = await h.api().patch('/api/auth/me').set('Authorization', `Bearer ${t.token}`).send({ govtId: 'X999', name: 'Other' });
      assert.equal(bad.status, 400);
      const ok = await h.api().patch('/api/auth/me').set('Authorization', `Bearer ${t.token}`).send({ phone: '+441234567890', emergencyContact: { name: 'New Contact' } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.user.emergencyContact.name, 'New Contact');
    });
  });

  // ---------------- TEST 1 ----------------
  it('TEST 1: register -> login -> Digital ID on chain -> QR verifies VALID', async () => {
    const t = await h.registerTourist();
    assert.equal(t.digitalId.chainStatus, 'pending');
    const login = await h.api().post('/api/auth/login').send({ email: t.user.email, password: 'Str0ng!Pass' });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'tourist');

    const ChainProof = require('../models/ChainProof');
    const proof = await h.waitFor(() => ChainProof.findOne({ kind: 'ID_REGISTER', refId: t.user._id, status: 'confirmed' }).lean());
    assert.match(proof.txHash, /^0x[0-9a-f]{64}$/);

    const myId = await h.api().get('/api/verify/my-id').set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(myId.status, 200);
    assert.match(myId.body.qr, /^data:image\/png;base64,/);
    assert.equal(myId.body.qrText, `TSID:${t.user.idHash}`);

    // The operator scans the QR text (prefix included) -> VALID with every check passing
    const verify = await h.api().get(`/api/verify/id/${encodeURIComponent(myId.body.qrText)}`).set('Authorization', `Bearer ${admin.token}`);
    assert.equal(verify.status, 200);
    assert.equal(verify.body.verdict, 'VALID', JSON.stringify(verify.body.checks));
    assert.equal(verify.body.tourist.govtId, undefined); // never exposed

    const unknown = await h.api().get(`/api/verify/id/0x${'ab'.repeat(32)}`).set('Authorization', `Bearer ${admin.token}`);
    assert.equal(unknown.body.verdict, 'UNKNOWN ID');
  });

  it('Digital ID: tampered record and expired trip are detected', async () => {
    const User = require('../models/User');
    const t = await h.registerTourist();
    await h.waitFor(() => User.findOne({ _id: t.user._id, idChainStatus: 'confirmed' }).lean());
    await User.updateOne({ _id: t.user._id }, { govtId: 'FORGED123' }); // edit behind the app's back
    const tampered = await h.api().get(`/api/verify/id/${t.user.idHash}`).set('Authorization', `Bearer ${admin.token}`);
    assert.equal(tampered.body.verdict, 'TAMPERED');

    const e = await h.registerTourist();
    await h.waitFor(() => User.findOne({ _id: e.user._id, idChainStatus: 'confirmed' }).lean());
    // expire the trip WITHOUT changing the hash inputs: we cannot, so emulate by moving the clock-relevant field and recomputing
    const { computeIdHash } = require('../utils/digitalId');
    const full = await User.findById(e.user._id).select('+salt');
    full.tripStart = new Date(Date.now() - 10 * 864e5);
    full.tripEnd = new Date(Date.now() - 864e5);
    full.idHash = computeIdHash(full, full.salt);
    await full.save({ validateBeforeSave: false });
    await require('../services/chainProofs').submit('ID_REGISTER', full._id, full.idHash);
    const expired = await h.api().get(`/api/verify/id/${full.idHash}`).set('Authorization', `Bearer ${admin.token}`);
    assert.equal(expired.body.verdict, 'EXPIRED');
  });

  // ---------------- TEST 2 ----------------
  it('TEST 2: tourist location -> saved in MongoDB -> pushed to operator map (multiple tourists)', async () => {
    const a = await h.registerTourist();
    const b = await h.registerTourist();
    const far = { lat: 17.45, lng: 78.38 }; // outside every test zone
    const seenA = h.waitForEvent(adminSocket, 'location:update', (u) => u.userId === a.user._id);
    const seenB = h.waitForEvent(adminSocket, 'location:update', (u) => u.userId === b.user._id);
    const resA = await h.api().post('/api/tourists/location').set('Authorization', `Bearer ${a.token}`).send({ ...far, accuracy: 12 });
    const resB = await h.api().post('/api/tourists/location').set('Authorization', `Bearer ${b.token}`).send({ lat: far.lat + 0.001, lng: far.lng, accuracy: 8 });
    assert.equal(resA.status, 201);
    assert.equal(resB.status, 201);
    const [ua, ub] = await Promise.all([seenA, seenB]);
    assert.equal(ua.lat, far.lat);
    assert.equal(ua.accuracy, 12);
    assert.equal(ub.zoneType, 'none');

    const Location = require('../models/Location');
    const saved = await Location.findOne({ userId: a.user._id }).lean();
    assert.deepEqual(saved.location.coordinates, [far.lng, far.lat]); // GeoJSON order
    assert.equal(saved.accuracy, 12);

    const list = await h.api().get('/api/tourists').set('Authorization', `Bearer ${admin.token}`);
    const rowA = list.body.tourists.find((t) => t._id === a.user._id);
    assert.equal(rowA.liveStatus, 'safe');
    assert.deepEqual(rowA.lastLocation.coordinates, [far.lng, far.lat]);
  });

  it('location validation, throttling and authorization', async () => {
    const t = await h.registerTourist();
    const auth = { Authorization: `Bearer ${t.token}` };
    for (const body of [{ lat: '17', lng: 78 }, { lat: 95, lng: 78 }, { lat: 17, lng: 181 }, {}, { lat: 17, lng: 78, accuracy: -5 }]) {
      assert.equal((await h.api().post('/api/tourists/location').set(auth).send(body)).status, 400, JSON.stringify(body));
    }
    // operators cannot submit tourist locations
    assert.equal((await h.api().post('/api/tourists/location').set('Authorization', `Bearer ${admin.token}`).send({ lat: 17, lng: 78 })).status, 403);
    // server-side throttle
    const config = require('../config');
    config.minLocationIntervalMs = 5000;
    try {
      assert.equal((await h.api().post('/api/tourists/location').set(auth).send({ lat: 17.45, lng: 78.38 })).status, 201);
      assert.equal((await h.api().post('/api/tourists/location').set(auth).send({ lat: 17.45, lng: 78.38 })).status, 429);
    } finally {
      config.minLocationIntervalMs = 0;
    }
  });

  // ---------------- TEST 3 + 4 ----------------
  it('TEST 3 & 4: entering yellow then red zones raises one alert each (no repeats inside the zone)', async () => {
    const t = await h.registerTourist();
    const touristSocket = await h.connectSocket(t.token);
    try {
      const auth = { Authorization: `Bearer ${t.token}` };
      const yellowAlert = h.waitForEvent(touristSocket, 'alert', (a) => a.kind === 'ZONE_ENTRY' && a.zoneType === 'yellow');
      const adminYellow = h.waitForEvent(adminSocket, 'alert', (a) => a.kind === 'ZONE_ENTRY' && a.touristId === t.user._id && a.zoneType === 'yellow');
      const r1 = await h.api().post('/api/tourists/location').set(auth).send({ ...CHARMINAR, accuracy: 10 });
      assert.equal(r1.body.zoneType, 'yellow');
      assert.match((await yellowAlert).touristMessage, /Caution/);
      await adminYellow;

      // Still inside: no new alert
      const r2 = await h.api().post('/api/tourists/location').set(auth).send({ lat: CHARMINAR.lat + 0.001, lng: CHARMINAR.lng, accuracy: 10 });
      assert.equal(r2.body.alert, null);

      // Inaccurate reading inside the red zone: uncertain, no alert
      const redCentre = { lat: CHARMINAR.lat, lng: CHARMINAR.lng + 0.03 };
      const r3 = await h.api().post('/api/tourists/location').set(auth).send({ ...redCentre, accuracy: 900 });
      assert.equal(r3.body.zoneConfidence, 'uncertain');
      assert.equal(r3.body.alert, null);

      const redAlert = h.waitForEvent(touristSocket, 'alert', (a) => a.kind === 'ZONE_ENTRY' && a.zoneType === 'red');
      const r4 = await h.api().post('/api/tourists/location').set(auth).send({ ...redCentre, accuracy: 10 });
      assert.equal(r4.body.zoneType, 'red');
      const ra = await redAlert;
      assert.equal(ra.severity, 'high');
      assert.match(ra.touristMessage, /restricted/i);

      const Alert = require('../models/Alert');
      assert.equal(await Alert.countDocuments({ touristId: t.user._id, kind: 'ZONE_ENTRY' }), 2);
      // Notifications were recorded honestly: no provider configured -> not_configured, never "sent"
      const Notification = require('../models/Notification');
      await h.waitFor(() => Notification.exists({ userId: t.user._id, event: 'ZONE_RED' }));
      assert.equal(await Notification.countDocuments({ userId: t.user._id, status: 'sent' }), 0);
      assert.ok(await Notification.exists({ userId: t.user._id, status: 'not_configured' }));

      const notes = await h.api().get('/api/tourists/me/notifications').set(auth);
      assert.ok(notes.body.alerts.length >= 2);
    } finally {
      touristSocket.close();
    }
  });

  it('zone CRUD with validation; tourists cannot modify zones', async () => {
    const auth = { Authorization: `Bearer ${admin.token}` };
    const bowtie = { type: 'Polygon', coordinates: [[[78, 17], [78.01, 17.01], [78.01, 17], [78, 17.01], [78, 17]]] };
    assert.equal((await h.api().post('/api/zones').set(auth).send({ name: 'Bad', type: 'red', geometry: bowtie })).status, 400);
    assert.equal((await h.api().post('/api/zones').set(auth).send({ name: 'Bad', type: 'purple', geometry: h.square(78, 17, 0.01) })).status, 400);
    const created = await h.api().post('/api/zones').set(auth).send({ name: 'Temp', type: 'green', geometry: h.square(78.2, 17.2, 0.01) });
    assert.equal(created.status, 201);
    const id = created.body.zone._id;
    const edited = await h.api().put(`/api/zones/${id}`).set(auth).send({ name: 'Temp 2', type: 'yellow', geometry: h.square(78.2, 17.2, 0.02) });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.zone.type, 'yellow');
    assert.equal(edited.body.zone.geometry.coordinates[0][0][0], 78.18);

    const t = await h.registerTourist();
    const tAuth = { Authorization: `Bearer ${t.token}` };
    assert.equal((await h.api().get('/api/zones').set(tAuth)).status, 200); // read allowed
    assert.equal((await h.api().put(`/api/zones/${id}`).set(tAuth).send({ type: 'green' })).status, 403);
    assert.equal((await h.api().delete(`/api/zones/${id}`).set(tAuth)).status, 403);

    assert.equal((await h.api().delete(`/api/zones/${id}`).set(auth)).status, 200);
    assert.equal((await h.api().get(`/api/zones/${id}`).set(auth)).status, 404);
  });

  // ---------------- TEST 5 ----------------
  it('TEST 5: SOS -> incident -> operator notified -> assign -> resolve (with duplicate protection)', async () => {
    const t = await h.registerTourist();
    const touristSocket = await h.connectSocket(t.token);
    try {
      const auth = { Authorization: `Bearer ${t.token}` };
      const opAlert = h.waitForEvent(adminSocket, 'alert', (a) => a.kind === 'SOS' && a.touristId === t.user._id);
      const opIncident = h.waitForEvent(adminSocket, 'incident', (i) => i.touristId?._id === t.user._id);
      const sos = await h.api().post('/api/incidents/sos').set(auth).send({ lat: 17.4, lng: 78.45, accuracy: 15, message: 'Lost and scared' });
      assert.equal(sos.status, 201, JSON.stringify(sos.body));
      const incidentId = sos.body.incident._id;
      assert.equal(sos.body.incident.status, 'Reported');
      assert.equal(sos.body.incident.notes, undefined); // tourists never see operator notes
      assert.equal((await opAlert).severity, 'critical');
      assert.equal((await opIncident)._id, incidentId);

      // Duplicate within 30 s -> ignored, points at the same incident
      const dup = await h.api().post('/api/incidents/sos').set(auth).send({ lat: 17.4, lng: 78.45 });
      assert.equal(dup.body.duplicate, true);
      assert.equal(String(dup.body.incidentId), incidentId);

      // Concurrent double press from a fresh tourist: exactly one incident
      const t2 = await h.registerTourist();
      const both = await Promise.all([1, 2].map(() => h.api().post('/api/incidents/sos').set('Authorization', `Bearer ${t2.token}`).send({ lat: 17.4, lng: 78.45 })));
      assert.deepEqual(both.map((r) => r.status).sort(), [200, 201]);

      const opAuth = { Authorization: `Bearer ${admin.token}` };
      // Invalid transition and missing officer
      assert.equal((await h.api().patch(`/api/incidents/${incidentId}/status`).set(opAuth).send({ status: 'Reported' })).status, 400);
      assert.equal((await h.api().patch(`/api/incidents/${incidentId}/status`).set(opAuth).send({ status: 'Assigned' })).status, 400);
      // Tourist cannot change status
      assert.equal((await h.api().patch(`/api/incidents/${incidentId}/status`).set(auth).send({ status: 'Assigned', assignedTo: 'X' })).status, 403);

      const helpAlert = h.waitForEvent(touristSocket, 'alert', (a) => a.kind === 'INCIDENT_UPDATE' && /assigned/i.test(a.title));
      const assigned = await h.api().patch(`/api/incidents/${incidentId}/status`).set(opAuth).send({ status: 'Assigned', assignedTo: 'Patrol 12', note: 'Dispatched', revision: 0 });
      assert.equal(assigned.status, 200);
      assert.equal(assigned.body.incident.assignedTo, 'Patrol 12');
      await helpAlert;

      // Stale revision -> 409 (concurrent edit protection)
      const stale = await h.api().patch(`/api/incidents/${incidentId}/status`).set(opAuth).send({ status: 'Resolved', revision: 0 });
      assert.equal(stale.status, 409);

      const note = await h.api().post(`/api/incidents/${incidentId}/notes`).set(opAuth).send({ text: 'Tourist found near the gate' });
      assert.equal(note.status, 201);
      const resolved = await h.api().patch(`/api/incidents/${incidentId}/status`).set(opAuth).send({ status: 'Resolved', note: 'Safe', revision: note.body.incident.revision });
      assert.equal(resolved.status, 200);
      assert.deepEqual(resolved.body.incident.history.map((x) => x.status), ['Reported', 'Assigned', 'Resolved']);
      assert.equal((await h.api().patch(`/api/incidents/${incidentId}/status`).set(opAuth).send({ status: 'Resolved' })).status, 400);

      // Search and filters
      const search = await h.api().get('/api/incidents?q=scared&status=Resolved').set(opAuth);
      assert.ok(search.body.incidents.some((i) => i._id === incidentId));
      const mine = await h.api().get('/api/incidents').set(auth);
      assert.ok(mine.body.incidents.every((i) => i.touristId._id === t.user._id || i.touristId === t.user._id));
    } finally {
      touristSocket.close();
    }
  });

  it('SOS falls back to last known location, and fails clearly without any location', async () => {
    const t = await h.registerTourist();
    const auth = { Authorization: `Bearer ${t.token}` };
    const none = await h.api().post('/api/incidents/sos').set(auth).send({});
    assert.equal(none.status, 400);
    assert.equal(none.body.code, 'LOCATION_UNKNOWN');
    await h.api().post('/api/tourists/location').set(auth).send({ lat: 17.44, lng: 78.39, accuracy: 20 });
    const sos = await h.api().post('/api/incidents/sos').set(auth).send({});
    assert.equal(sos.status, 201); // the failed attempt did not leave a 30 s lock behind
    assert.equal(sos.body.incident.locationSource, 'last_known');
  });

  it('tourists cannot read other tourists\' incidents (IDOR) and can cancel only their own Reported SOS', async () => {
    const a = await h.registerTourist();
    const b = await h.registerTourist();
    const sos = await h.api().post('/api/incidents/sos').set('Authorization', `Bearer ${a.token}`).send({ lat: 17.41, lng: 78.41 });
    const id = sos.body.incident._id;
    assert.equal((await h.api().get(`/api/incidents/${id}`).set('Authorization', `Bearer ${b.token}`)).status, 404);
    assert.equal((await h.api().post(`/api/incidents/${id}/cancel`).set('Authorization', `Bearer ${b.token}`).send({})).status, 404);
    const cancel = await h.api().post(`/api/incidents/${id}/cancel`).set('Authorization', `Bearer ${a.token}`).send({ reason: 'False alarm' });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.incident.resolution, 'cancelled_by_tourist');
    assert.equal((await h.api().post(`/api/incidents/${id}/cancel`).set('Authorization', `Bearer ${a.token}`).send({})).status, 409);
  });

  // ---------------- TEST 6 ----------------
  it('TEST 6: incident proofs on chain; editing the record is detected as TAMPERED', async () => {
    const t = await h.registerTourist();
    const sos = await h.api().post('/api/incidents/sos').set('Authorization', `Bearer ${t.token}`).send({ lat: 17.42, lng: 78.43, message: 'Original' });
    const id = sos.body.incident._id;
    const Incident = require('../models/Incident');
    await h.waitFor(() => Incident.findOne({ _id: id, chainStatus: 'confirmed' }).lean());
    const opAuth = { Authorization: `Bearer ${admin.token}` };
    const ok = await h.api().get(`/api/verify/incident/${id}`).set(opAuth);
    assert.equal(ok.body.verdict, 'INTACT', JSON.stringify(ok.body.checks));

    // Legitimate change through the API -> new proof -> INTACT again once confirmed
    await h.api().patch(`/api/incidents/${id}/status`).set(opAuth).send({ status: 'Assigned', assignedTo: 'Unit 7' });
    await h.waitFor(async () => (await h.api().get(`/api/verify/incident/${id}`).set(opAuth)).body.verdict === 'INTACT');
    const detail = await h.api().get(`/api/incidents/${id}`).set(opAuth);
    assert.equal(detail.body.proofs.filter((p) => p.status === 'confirmed').length, 2);

    // Tamper with MongoDB directly
    await Incident.updateOne({ _id: id }, { message: 'Edited afterwards' });
    const bad = await h.api().get(`/api/verify/incident/${id}`).set(opAuth);
    assert.equal(bad.body.verdict, 'TAMPERED');
    assert.equal(bad.body.intact, false);
  });

  // ---------------- TEST 7 ----------------
  it('TEST 7: revoke Digital ID -> scan -> REVOKED; history recorded', async () => {
    const t = await h.registerTourist();
    const User = require('../models/User');
    await h.waitFor(() => User.findOne({ _id: t.user._id, idChainStatus: 'confirmed' }).lean());
    const opAuth = { Authorization: `Bearer ${admin.token}` };
    assert.equal((await h.api().post(`/api/verify/id/${t.user.idHash}/revoke`).set(opAuth).send({})).status, 400); // reason required
    // tourists cannot revoke
    assert.equal((await h.api().post(`/api/verify/id/${t.user.idHash}/revoke`).set('Authorization', `Bearer ${t.token}`).send({ reason: 'x' })).status, 403);

    const rev = await h.api().post(`/api/verify/id/${t.user.idHash}/revoke`).set(opAuth).send({ reason: 'Fraudulent documents' });
    assert.equal(rev.status, 200);
    assert.equal(rev.body.verdict, 'REVOKED');
    assert.equal(rev.body.revocation.chainStatus, 'confirmed');
    const scan = await h.api().get(`/api/verify/id/TSID:${t.user.idHash}`).set(opAuth);
    assert.equal(scan.body.verdict, 'REVOKED');
    assert.ok(scan.body.checks.find((c) => c.label === 'Not revoked on blockchain').ok === false);
    const history = await h.api().get('/api/verify/revocations').set(opAuth);
    const row = history.body.revocations.find((r) => r.touristId === t.user._id);
    assert.equal(row.reason, 'Fraudulent documents');
    assert.equal(row.chainStatus, 'confirmed');
    assert.equal((await h.api().post(`/api/verify/id/${t.user.idHash}/revoke`).set(opAuth).send({ reason: 'again' })).status, 409);
  });

  // ---------------- TEST 9 ----------------
  it('TEST 9: tourist calling operator APIs gets 403', async () => {
    const t = await h.registerTourist();
    const auth = { Authorization: `Bearer ${t.token}` };
    for (const [method, url] of [
      ['get', '/api/tourists'], ['get', '/api/tourists/alerts'], ['get', `/api/tourists/${t.user._id}`],
      ['get', '/api/admin/stats'], ['get', '/api/admin/audit'], ['get', '/api/admin/reports/export?type=tourists'],
      ['get', `/api/verify/id/${t.user.idHash}`], ['get', '/api/verify/chain'], ['post', '/api/admin/operators'], ['post', '/api/admin/risk/train'],
    ]) {
      const res = await h.api()[method](url).set(auth).send({});
      assert.equal(res.status, 403, `${method} ${url}`);
    }
  });

  it('operator dashboard, reports, CSV export, audit log and risk model use real data', async () => {
    const opAuth = { Authorization: `Bearer ${admin.token}` };
    const stats = await h.api().get('/api/admin/stats').set(opAuth);
    assert.equal(stats.status, 200);
    const User = require('../models/User');
    assert.equal(stats.body.tourists.total, await User.countDocuments({ role: 'tourist' }));
    assert.equal(stats.body.blockchain.ok, true);
    const summary = await h.api().get('/api/admin/reports/summary').set(opAuth);
    assert.ok(summary.body.incidents.byType.SOS >= 1);
    const csv = await h.api().get('/api/admin/reports/export?type=incidents').set(opAuth);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.text, /"id","createdAt","type"/);
    const tcsv = await h.api().get('/api/admin/reports/export?type=tourists').set(opAuth);
    assert.doesNotMatch(tcsv.text, /govtId|passwordHash/);
    const audit = await h.api().get('/api/admin/audit?action=SOS_CREATE').set(opAuth);
    assert.ok(audit.body.total >= 1);
    const train = await h.api().post('/api/admin/risk/train').set(opAuth);
    assert.equal(train.status, 201);
    assert.equal(train.body.model.status, 'insufficient_data'); // honest: too few incidents to train
    const pred = await h.api().get(`/api/admin/risk/predict?lat=${CHARMINAR.lat}&lng=${CHARMINAR.lng}`).set(opAuth);
    assert.equal(pred.body.modelAvailable, false);
    assert.equal(pred.body.method, 'baseline-heuristic');
    // operators can create operators; weak passwords rejected
    assert.equal((await h.api().post('/api/admin/operators').set(opAuth).send({ name: 'Op', email: 'op2@example.com', password: 'weak' })).status, 400);
    assert.equal((await h.api().post('/api/admin/operators').set(opAuth).send({ name: 'Op', email: 'op2@example.com', password: 'Op3rator!Pass' })).status, 201);
  });

  // ---------------- TEST 10 ----------------
  it('TEST 10: socket auth, room isolation, reconnect without duplicate events', async () => {
    await assert.rejects(h.connectSocket('bad-token'));
    const a = await h.registerTourist();
    const b = await h.registerTourist();
    const sockA = await h.connectSocket(a.token);
    const sockB = await h.connectSocket(b.token);
    try {
      // B must not receive A's private location echo, and tourists never get the operator stream
      let leaked = 0;
      sockB.on('location:self', (u) => u.userId === a.user._id && leaked++);
      sockB.on('location:update', () => leaked++);
      const echo = h.waitForEvent(sockA, 'location:self', (u) => u.userId === a.user._id);
      await h.api().post('/api/tourists/location').set('Authorization', `Bearer ${a.token}`).send({ lat: 17.46, lng: 78.37 });
      await echo;
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(leaked, 0);

      // Disconnect + reconnect: exactly one event per update afterwards
      sockA.disconnect();
      const again = await h.connectSocket(a.token);
      let count = 0;
      again.on('location:self', () => count++);
      await h.api().post('/api/tourists/location').set('Authorization', `Bearer ${a.token}`).send({ lat: 17.461, lng: 78.37 });
      await h.waitFor(() => count >= 1, { timeout: 3000 });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(count, 1);
      again.close();
    } finally {
      sockA.close();
      sockB.close();
    }
  });

  // ---------------- Safety tools ----------------
  describe('safety tools', () => {
    const safety = require('../services/safety');

    it('check-in timer: missed check-in alerts operators once, tourist can then confirm safe', async () => {
      const t = await h.registerTourist();
      const auth = { Authorization: `Bearer ${t.token}` };
      assert.equal((await h.api().post('/api/safety/checkin').set(auth).send({ minutes: 2 })).status, 400);
      assert.equal((await h.api().post('/api/safety/checkin').set({ Authorization: `Bearer ${admin.token}` }).send({ minutes: 30 })).status, 403);
      const started = await h.api().post('/api/safety/checkin').set(auth).send({ minutes: 30, note: 'Walking to the fort' });
      assert.equal(started.status, 201);
      const overview = await h.api().get('/api/safety/overview').set('Authorization', `Bearer ${admin.token}`);
      assert.ok(overview.body.checkIns.some((c) => c._id === started.body.checkIn._id));

      // Time passes: move the deadline into the past and run the sweeper
      const SafetyCheckIn = require('../models/SafetyCheckIn');
      await SafetyCheckIn.updateOne({ _id: started.body.checkIn._id }, { dueAt: new Date(Date.now() - 1000) });
      const missedAlert = h.waitForEvent(adminSocket, 'alert', (a) => a.kind === 'CHECKIN_MISSED' && a.touristId === t.user._id);
      const r1 = await safety.sweep();
      assert.ok(r1.missedCheckIns >= 1);
      assert.equal((await missedAlert).severity, 'high');
      assert.equal((await safety.sweep()).missedCheckIns, 0); // no duplicate alert
      const Notification = require('../models/Notification');
      await h.waitFor(() => Notification.exists({ userId: t.user._id, event: 'CHECKIN_MISSED' }));

      const safe = await h.api().post('/api/safety/checkin/safe').set(auth);
      assert.equal(safe.status, 200);
      assert.equal(safe.body.checkIn.status, 'completed');
      assert.equal((await h.api().post('/api/safety/checkin/safe').set(auth)).status, 404);
    });

    it('journey: off-route needs 3 accurate readings, alerts once, then arrival ends it', async () => {
      const t = await h.registerTourist();
      const auth = { Authorization: `Bearer ${t.token}` };
      const route = { type: 'LineString', coordinates: [[78.40, 17.45], [78.42, 17.45]] }; // ~2.1 km east-west
      assert.equal((await h.api().post('/api/safety/journey').set(auth).send({ route: { type: 'Point' } })).status, 400);
      const start = await h.api().post('/api/safety/journey').set(auth).send({ route, destinationName: 'Test Gate', mode: 'foot', durationS: 1500 });
      assert.equal(start.status, 201);

      const send = (lat, lng, accuracy = 10) => h.api().post('/api/tourists/location').set(auth).send({ lat, lng, accuracy });
      const onRoute = await send(17.4501, 78.405);
      assert.equal(onRoute.body.journey.event, null);
      assert.ok(onRoute.body.journey.distanceFromRouteM < 50);

      const deviation = h.waitForEvent(adminSocket, 'alert', (a) => a.touristId === t.user._id && a.details?.rule === 'ROUTE_DEVIATION');
      assert.equal((await send(17.46, 78.41, 900)).body.journey.event, null); // inaccurate: ignored
      assert.equal((await send(17.46, 78.41)).body.journey.event, null); // 1st
      assert.equal((await send(17.4605, 78.41)).body.journey.event, null); // 2nd
      assert.equal((await send(17.461, 78.41)).body.journey.event, 'deviation'); // 3rd -> alert
      assert.ok((await deviation).message.includes('planned route'));
      assert.equal((await send(17.4615, 78.41)).body.journey.event, null); // still off: no repeat
      assert.equal((await send(17.4501, 78.415)).body.journey.event, 'back_on_route');

      const arrived = await send(17.45, 78.4199);
      assert.equal(arrived.body.journey.event, 'arrived');
      assert.equal((await h.api().get('/api/safety/journey').set(auth)).body.journey, null);
    });

    it('journey overdue is detected by the sweeper', async () => {
      const t = await h.registerTourist();
      const auth = { Authorization: `Bearer ${t.token}` };
      const start = await h.api().post('/api/safety/journey').set(auth).send({ route: { type: 'LineString', coordinates: [[78.30, 17.40], [78.31, 17.40]] }, durationS: 600 });
      const Journey = require('../models/Journey');
      await Journey.updateOne({ _id: start.body.journey._id }, { expectedArrivalAt: new Date(Date.now() - 3600e3) });
      const overdue = h.waitForEvent(adminSocket, 'alert', (a) => a.kind === 'JOURNEY' && a.touristId === t.user._id);
      assert.ok((await safety.sweep()).overdueJourneys >= 1);
      await overdue;
      const ended = await h.api().post('/api/safety/journey/end').set(auth).send({ arrived: true });
      assert.equal(ended.body.journey.status, 'arrived');
    });

    it('broadcast reaches only tourists inside the chosen zone (or everyone)', async () => {
      const inside = await h.registerTourist();
      const outside = await h.registerTourist();
      await h.api().post('/api/tourists/location').set('Authorization', `Bearer ${inside.token}`).send({ ...CHARMINAR, accuracy: 10 });
      await h.api().post('/api/tourists/location').set('Authorization', `Bearer ${outside.token}`).send({ lat: 17.47, lng: 78.36, accuracy: 10 });
      const sIn = await h.connectSocket(inside.token);
      const sOut = await h.connectSocket(outside.token);
      try {
        let outsideGot = 0;
        sOut.on('alert', (a) => a.kind === 'BROADCAST' && a.title === 'Crowd warning' && outsideGot++);
        const got = h.waitForEvent(sIn, 'alert', (a) => a.kind === 'BROADCAST' && a.title === 'Crowd warning');
        const opAuth = { Authorization: `Bearer ${admin.token}` };
        assert.equal((await h.api().post('/api/safety/broadcasts').set(opAuth).send({ title: 'x', message: '' })).status, 400);
        assert.equal((await h.api().post('/api/safety/broadcasts').set({ Authorization: `Bearer ${inside.token}` }).send({ title: 'Hi there', message: 'Hello' })).status, 403);
        const sent = await h.api().post('/api/safety/broadcasts').set(opAuth).send({ title: 'Crowd warning', message: 'Festival crowd near the market', severity: 'warning', target: 'zone', zoneId: zones.yellow._id });
        assert.equal(sent.status, 201);
        assert.ok(sent.body.broadcast.recipients >= 1);
        assert.equal((await got).severity, 'warning');
        await new Promise((r) => setTimeout(r, 300));
        assert.equal(outsideGot, 0);
        const all = await h.api().post('/api/safety/broadcasts').set(opAuth).send({ title: 'City notice', message: 'Heavy rain expected tonight', target: 'all' });
        const User = require('../models/User');
        assert.equal(all.body.broadcast.recipients, await User.countDocuments({ role: 'tourist', status: 'active' }));
        const notes = await h.api().get('/api/tourists/me/notifications').set('Authorization', `Bearer ${outside.token}`);
        assert.ok(notes.body.alerts.some((a) => a.title === 'City notice'));
      } finally {
        sIn.close();
        sOut.close();
      }
    });
  });

  // ---------------- Hosting setup (operator account) ----------------
  it('setup: trims pasted credentials, refuses a tourist email, and SETUP_ADMIN_RESET recovers the operator login', async () => {
    const { runSetup } = require('../services/setup');
    const quiet = { log: () => {}, warn: () => {} };
    const saved = { ...process.env };
    try {
      // A tourist email cannot become the operator
      const t = await h.registerTourist();
      Object.assign(process.env, { SETUP_ADMIN_EMAIL: t.user.email, SETUP_ADMIN_PASSWORD: 'Ops!Pass2026', SETUP_ADMIN_RESET: 'true' });
      await assert.rejects(runSetup(quiet), /registered as a tourist/);

      // Pasted values with spaces/newlines still give a working login
      Object.assign(process.env, { SETUP_ADMIN_EMAIL: '  Ops.Recover@Example.com \n', SETUP_ADMIN_PASSWORD: 'Ops!Pass2026 \n' });
      await runSetup(quiet);
      const ok = await h.api().post('/api/auth/login').send({ email: 'ops.recover@example.com', password: 'Ops!Pass2026' });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.user.role, 'admin');

      // Forgotten password: change SETUP_ADMIN_PASSWORD with the reset flag on -> new password works, old token revoked
      process.env.SETUP_ADMIN_PASSWORD = 'New!OpsPass2026';
      await runSetup(quiet);
      assert.equal((await h.api().post('/api/auth/login').send({ email: 'ops.recover@example.com', password: 'Ops!Pass2026' })).status, 401);
      assert.equal((await h.api().post('/api/auth/login').send({ email: 'ops.recover@example.com', password: 'New!OpsPass2026' })).status, 200);
      assert.equal((await h.api().get('/api/auth/me').set('Authorization', `Bearer ${ok.body.token}`)).status, 401);

      // Weak password is reported clearly
      process.env.SETUP_ADMIN_PASSWORD = 'weak';
      await assert.rejects(runSetup(quiet), /SETUP_ADMIN_PASSWORD needs/);
    } finally {
      for (const k of ['SETUP_ADMIN_EMAIL', 'SETUP_ADMIN_PASSWORD', 'SETUP_ADMIN_RESET']) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  // ---------------- TEST 8 (last: stops the chain) ----------------
  it('TEST 8: with the blockchain stopped, SOS still creates the incident and alerts operators', async () => {
    await h.stopChain();
    const t = await h.registerTourist(); // registration also works: ID stays pending
    const opAlert = h.waitForEvent(adminSocket, 'alert', (a) => a.kind === 'SOS' && a.touristId === t.user._id);
    const started = Date.now();
    const sos = await h.api().post('/api/incidents/sos').set('Authorization', `Bearer ${t.token}`).send({ lat: 17.43, lng: 78.44 });
    assert.equal(sos.status, 201);
    assert.ok(Date.now() - started < 3000, 'SOS must not wait for the chain');
    await opAlert;
    const Incident = require('../models/Incident');
    const inc = await h.waitFor(() => Incident.findOne({ _id: sos.body.incident._id, chainStatus: 'failed' }).lean());
    assert.equal(inc.status, 'Reported');

    const opAuth = { Authorization: `Bearer ${admin.token}` };
    const v = await h.api().get(`/api/verify/incident/${inc._id}`).set(opAuth);
    assert.equal(v.body.verdict, 'NOT CONFIRMED');
    const id = await h.api().get(`/api/verify/id/${t.user.idHash}`).set(opAuth);
    assert.equal(id.body.verdict, 'BLOCKCHAIN UNAVAILABLE'); // never VALID without the chain
    const health = await h.api().get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.blockchain.ok, false);
  });
});
