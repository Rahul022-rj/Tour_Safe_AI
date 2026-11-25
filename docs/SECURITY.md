# Security review

## Implemented controls

| Control | Where |
|---|---|
| Passwords hashed with bcrypt (cost 12, configurable); policy: 8+ chars, upper, lower, digit, symbol | `routes/auth.js`, `utils/validate.js` |
| Timing-equalised login (dummy hash for unknown emails), identical error for unknown user / wrong password | `routes/auth.js` |
| JWT HS256 with pinned algorithm, 8 h expiry, `tokenVersion` checked on **every** request and socket connection (password change, reset, suspension, "log out everywhere" revoke old tokens) | `middleware/auth.js` |
| Account status enforced server-side; suspended users are disconnected from Socket.IO | `middleware/auth.js`, `routes/tourist.js`, `socket.js` |
| Password reset: 256-bit random token, only its SHA-256 stored, 30 min expiry, single use (cleared atomically), generic responses (no account enumeration) | `routes/auth.js` |
| Role-based access on every operator route; tourists can only read/write their own data (IDOR: queries are scoped to `req.user.id`, other tourists' incidents return 404) | all routes |
| Public registration can never create operators | `routes/auth.js`, tested |
| Rate limits: failed logins 10/15 min per IP+email, password reset 5/h, registration 20/h, API 600/min, external lookups 30/min | `middleware/security.js` |
| Input validation for every body/query; MongoDB operator keys (`$…`, dotted keys) stripped recursively | `utils/validate.js`, `middleware/security.js` |
| Request size limit 200 kB; malformed JSON → 400 | `app.js` |
| Helmet security headers incl. Content-Security-Policy; `x-powered-by` off | `app.js` |
| CORS allow-list (`CLIENT_URL` + `CORS_EXTRA_ORIGINS`), also for Socket.IO | `app.js`, `socket.js` |
| Socket rooms assigned by the server from the verified token; clients cannot join rooms | `socket.js`, tested |
| Startup config validation (refuses to start in production without a strong `JWT_SECRET`, with a malformed `PRIVATE_KEY`, or without a key on non-Hardhat chains) | `config.js` |
| Production error responses never include stack traces or internal messages | `app.js` |
| Audit log of logins, failed logins, profile/password changes, zone/incident/ID actions, exports, location-history views | `services/audit.js` |
| No secrets in logs: passwords, tokens and government IDs are never logged; phone/email masked in notification history | `services/notify.js`, `utils/http.js` |
| Blockchain: only hashes on chain; signing key only from env; local unlocked account only accepted on chain 31337 | `services/blockchain.js` |
| CSV exports exclude government ID numbers and passwords, and neutralise spreadsheet formulas | `routes/admin.js` |
| Location history auto-deleted after `LOCATION_RETENTION_DAYS` (TTL index) | `models/Location.js` |

## Known limitations / required for a real deployment

1. **Token storage:** the JWT is kept in `localStorage` so the Socket.IO handshake can send it. An XSS bug could steal it. React escapes output and the CSP blocks inline scripts, which limits the risk; an httpOnly-cookie session (with CSRF protection) would be stronger.
2. **HTTPS is mandatory in production** (geolocation and camera need it; tokens must not travel in clear text). Terminate TLS at a reverse proxy (nginx, Caddy), set `TRUST_PROXY=true`, and add HSTS there.
3. **Rate limits and Socket.IO presence are in-memory** (per instance). For several instances add a shared store (e.g. Redis for `express-rate-limit` and `@socket.io/redis-adapter`). SOS duplicate protection is already shared (MongoDB).
4. **MongoDB** should run with authentication and TLS; use a least-privilege database user in `MONGODB_URI`.
5. **Government ID numbers are stored in clear text** in MongoDB (needed to recompute the ID hash). Use MongoDB encryption at rest or field-level encryption in production.
6. **Local Hardhat chain** is a development tool: in memory, a single well-known key. Use a persistent permissioned/test network with a key from a secrets manager.
7. **Public OpenStreetMap services** (Nominatim, Overpass, OSRM demo servers) have strict usage policies and no SLA; self-host them for production traffic.
8. `npm audit` reports advisories in development-only dependencies (Hardhat toolchain, build tools). They are not shipped to the browser or the API runtime but should be reviewed before deployment.
9. No multi-factor authentication for operators yet.
