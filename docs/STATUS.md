# Project status (2026-11-25)

## How it was verified
- **Automated:** `npm test` → contract 7/7, backend 46/46 (19 unit + 27 end-to-end against real MongoDB, a real Hardhat node and real Socket.IO clients), frontend 20/20 (Vitest + Testing Library + jsdom). Production build succeeds.
- **Live stack:** Hardhat node + deployed contract + `npm run setup` + `npm run dev`; a new tourist registered through the browser and used dashboard, Digital ID, check-in timer and SOS (with a real browser location), then the operator view; API smoke test through the Vite proxy including the real OSRM, Nominatim and Overpass services.
- **Browser:** operator and tourist pages checked in Chrome (login, dashboard, incidents incl. assigning, blockchain, settings, tourist dashboard, Digital ID, live map) with no console errors.

The 10 required workflows are automated in `backend/test/integration.test.js` (TEST 1 … TEST 10).

## Acceptance checklist

### Fully implemented and tested (automated and/or live)
- Tourist registration, login, operator login, JWT, role-based authorization (TEST 9), logout, session expiry, password change/reset, suspension
- Tourist profile (contact, emergency contact, preferences)
- Location updates reach the backend, are validated, throttled and saved in MongoDB; marker updates over Socket.IO; operator sees multiple tourists (TEST 2)
- Zone creation, editing (incl. geometry), deletion, validation; geofence detection; yellow and red alerts without repeats; accuracy-aware confidence (TEST 3, 4)
- SOS creates an incident, operators notified, assign, notes, resolve, invalid transitions and concurrent edits rejected, duplicate protection incl. simultaneous presses (TEST 5)
- QR Digital ID generation, verification (VALID / UNKNOWN / TAMPERED / EXPIRED / REVOKED / BLOCKCHAIN UNAVAILABLE), on-chain registration and revocation (TEST 1, 7)
- Incident hash logging and integrity verification incl. tamper detection (TEST 6)
- Blockchain failure does not stop SOS or registration (TEST 8)
- Socket authentication, room isolation, reconnect without duplicate events (TEST 10)
- Operator dashboard and reports use database data; CSV export; audit log
- Safe routing with a real routing service (OSRM, verified live), geocoding (Nominatim, verified live)
- Error handling: database/chain/network failures, invalid input, expired auth, malformed JSON
- Safety check-in timer (missed → operator alert + emergency contact notification, late "I'm safe"), journey monitoring (off-route after 3 readings, arrival, overdue), zone/all advisories, offline SOS queue: automated tests + live run + browser check

### Implemented but not externally configured
- **Email notifications** (SMTP) and **SMS** (Twilio): implemented; the automated tests cover message planning and the `not_configured` path (no message is ever reported as sent without a provider), but no real or fake provider delivery was exercised. Set `SMTP_*` / `TWILIO_*` to activate.
- **Password reset email**: needs SMTP; in development the link is printed to the backend console.
- **Persistent blockchain network**: configuration and deploy script exist (`deploy:custom`); only the local Hardhat chain was used.

### Implemented but not fully tested
- **Real device GPS:** the browser tracking code is unit-tested with a fake geolocation API and the backend path is tested end-to-end, but granting browser location permission on a real phone over HTTPS must be done by a person.
- **Camera QR scanning:** uses html5-qrcode (camera or image file); verification of the scanned text is tested, the camera itself was not exercised automatically.
- **Nearby places from OpenStreetMap:** implemented with mirror racing, caching and labelled fallback; during testing every public Overpass server was overloaded, so only the fallback (demo records, clearly marked DEMO) was observed live.
- **Anomaly detection:** rules are unit-tested (speed); the time-based sweep (signal lost, restricted dwell) runs every minute but has no automated end-to-end test.
- **Risk model:** training/evaluation logic is unit-tested on synthetic data; on the real (small) dataset it correctly reports `insufficient_data`. No accuracy figures are claimed.
- Responsive layout: CSS breakpoints for tablet/phone written and the desktop layout checked; not checked on physical devices.

### Not implemented
- Weather data in the risk model (no reliable provider configured).
- Multi-instance infrastructure pieces (Redis rate-limit store, Socket.IO Redis adapter).
- Operator multi-factor authentication.

## Not production-ready yet
Before real use: HTTPS, MongoDB auth/TLS and encryption at rest, a persistent blockchain with a managed key, self-hosted or paid map services, configured email/SMS, and the items in [SECURITY.md](SECURITY.md).
