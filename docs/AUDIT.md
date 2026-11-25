# Phase 1: audit of the original repository

Snapshot audited: commit `aeb4955` (React/Vite frontend, Express 5 + MongoDB backend, Hardhat `TouristRegistry` contract, simulator).
The original code was clean and well-commented, and its core design was retained: Turf.js geofencing with highest-risk precedence, alerting on zone *change*, salted SHA-256 Digital IDs, incident hashing, Socket.IO rooms, and the contract itself (unchanged).

## Existing and working (kept)
- JWT login, bcrypt hashing, role guard (`requireRole`), forced `tourist` role on registration
- Browser `watchPosition` with the 5 s throttle and the specified options
- Zone CRUD (draw/delete), Turf point-in-polygon, overlap precedence, change-only alerts
- SOS with fallback to last known location, 30 s duplicate protection, Reported → Assigned → Resolved with atomic status update
- Digital ID QR, verification (database + chain), revocation, incident hash on chain
- Graceful handling of a stopped Hardhat node for SOS

## Incomplete / broken / missing (all addressed)

| Area | Finding | Resolution |
|---|---|---|
| Auth | Password min 6 chars, no confirm, no phone/email format checks | Strong password policy, full server + client validation with field errors |
| Auth | No password change / forgot / reset, no rate limiting, no logout on server, no account status | All added; single-use SHA-256-hashed reset tokens (30 min); `tokenVersion` revokes old JWTs; suspension |
| Auth | Registration failed entirely if the chain was down | Documented policy: save, queue on-chain registration, retry worker, ID not VALID until confirmed |
| Tracking | Accuracy not sent or stored; tracking lived in one page; not stopped on logout explicitly; no server-side throttle | Tracking context shared by all tourist pages, explicit stop on logout, accuracy/speed stored, atomic server throttle |
| Geofencing | Inaccurate readings treated as certain; editing a zone's shape impossible; no geometry validation beyond the 2dsphere index | Accuracy and boundary-aware confidence; shape editing; Turf kinks/area validation; re-classification after zone edits |
| Alerts | Kept in memory only (lost on restart, not shared across instances) | `Alert` collection; tourist notification page |
| SOS | Duplicate protection in process memory | `SosLock` collection, atomic upsert (works across instances) |
| Incidents | No notes, search, filtering by date, pagination, revision checks, tourist cancel | Added; optimistic concurrency via `revision` |
| Stations | Seeded model but **no API or UI** used it | `/api/geo/places` with OpenStreetMap Overpass + caching; demo records labelled DEMO |
| Routing | Not implemented | OSRM routes with alternatives, zone-crossing analysis, warnings, sources and disclaimer |
| Notifications | None | SMTP email + Twilio SMS, delivery history, honest statuses, de-duplication |
| Blockchain | Only the latest incident hash kept; no pending/failed lifecycle; signer hard-coded to Hardhat account; failures never retried | `ChainProof` lifecycle (pending/submitted/confirmed/failed), retry worker, env-configured wallet, idempotent sends, serialized nonces, chain-id check |
| Blockchain | Incident hash used plain `JSON.stringify` with fixed order but no float/undefined normalisation | Canonical serializer (sorted keys, ISO dates, rounded coordinates, versioned) |
| Verification | No BLOCKCHAIN UNAVAILABLE verdict (threw 503) | Verdict set completed; VALID never returned without a confirmed chain check |
| Dashboards | Single admin map page; no stats, reports, audit log, tourist management | Full operator console |
| Security | No Helmet, no rate limiting, no input sanitising beyond `String()`, default JWT secret silently used, stack traces in error responses | Helmet with CSP, rate limits, operator stripping, startup config validation, production error masking |
| Data | No TTL / retention, few indexes | TTL on locations (30 days) and audit logs (1 year); indexes on all list/filter queries |
| ML / anomaly | Not implemented | Experimental decision-tree risk model; anomaly review alerts |
| Tests | None | 42 backend, 19 frontend, 7 contract tests |
| Docs | README only | README, API reference, security review, status report |
| Demo data | A simulator posted fake positions and the seed created fake tourists | Simulator removed; only real device locations are accepted; setup creates no tourists and never deletes data unless `--reset --yes` |
