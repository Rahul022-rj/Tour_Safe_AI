# API reference

Base URL `/api`. JSON in and out. Authenticated endpoints need `Authorization: Bearer <token>`.
Errors: `{ message, code?, errors? }` where `errors` maps field names to messages (forms).
Roles: **T** = tourist, **O** = operator (`admin`), **A** = any logged-in user.

## Auth `/api/auth`
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/register` | public | Tourist only. Body: name, email, password, confirmPassword, phone, nationality, govtIdType, govtId, tripStart, tripEnd, emergencyContact {name, phone, email?, relation?}. Returns token, user, digitalId {chainStatus: pending} |
| POST | `/login` | public | email, password. 401 same message for unknown user / wrong password; 403 suspended; 429 rate limited |
| GET | `/me` | A | current user |
| PATCH | `/me` | A | phone, nationality, emergencyContact, notificationPrefs (identity fields are locked) |
| POST | `/change-password` | A | currentPassword, newPassword, confirmPassword → new token (other sessions revoked) |
| POST | `/forgot-password` | public | email → always the same generic answer |
| POST | `/reset-password` | public | email, token, newPassword, confirmPassword |
| POST | `/logout` | A | `{everywhere: true}` revokes all tokens; stops tracking |

## Tourists `/api/tourists`
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/location` | T | lat, lng, accuracy?, speed?, heading? → zone, confidence, alert. 429 if faster than `MIN_LOCATION_INTERVAL_MS` |
| POST | `/tracking` | T | `{active: boolean}` |
| GET | `/me/locations?limit` | T | own history |
| GET | `/me/notifications` | T | alerts + email/SMS delivery history; `POST /me/notifications/read` marks read |
| GET | `/?q&status&account&page&limit` | O | search with computed `liveStatus` (sos, restricted, caution, safe, stale, offline, no_data) |
| GET | `/alerts?kind&unreviewed&from&to` | O | recent alerts; `POST /alerts/:id/review` |
| GET | `/:id` | O | details, incidents, alerts |
| GET | `/:id/locations?from&to&limit` | O | movement history |
| PATCH | `/:id/status` | O | `{status: active|suspended, reason}` |

## Zones `/api/zones`
`GET /` (A), `GET /:id` (A), `POST /` (O: name, type red|yellow|green, description, source, geometry GeoJSON Polygon `[lng, lat]`), `PUT /:id` (O, any field incl. geometry), `DELETE /:id` (O).

## Incidents `/api/incidents`
| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/sos` | T | lat?, lng?, accuracy?, message? → 201 incident, or 200 `{duplicate, retryAfterSeconds}`, or 400 `LOCATION_UNKNOWN` |
| GET | `/?status=Open|Reported|Assigned|Resolved&type&q&from&to&page&limit` | A | operators see all, tourists their own |
| GET | `/:id` | A | operators also get the proof list; other tourists get 404 |
| PATCH | `/:id/status` | O | status, assignedTo (for Assigned), note, resolution (resolved|false_alarm), revision → 400 invalid transition, 409 conflict |
| POST | `/:id/notes` | O | text, revision? |
| POST | `/:id/cancel` | T | own incident, only while Reported |

## Verification `/api/verify`
`GET /my-id` (T: QR data URL, qrText `TSID:0x…`, verification result) · `GET /id/:idHash` (O, accepts the `TSID:` prefix) · `POST /id/:idHash/revoke` (O, `{reason}`) · `GET /revocations` (O) · `GET /incident/:id` (O) · `GET /chain` (O) · `POST /chain/retry` (O) · `GET /proofs?kind&status` (O)

## Geo `/api/geo` (A, 30 req/min)
`GET /places?lat&lng&type=police|hospital&radius` · `GET /route?fromLat&fromLng&toLat&toLng&mode=foot|car|bike` · `GET /search?q` · `GET /reverse?lat&lng` · `GET /risk?lat&lng` (experimental)

## Safety `/api/safety`
| Method | Path | Access | Notes |
|---|---|---|---|
| GET / POST / DELETE | `/checkin` | T | current timer / start `{minutes 5-720, note?}` / cancel |
| POST | `/checkin/safe` | T | "I'm safe": completes the active timer or a timer missed in the last 24 h |
| GET / POST | `/journey` | T | current journey / start `{route: LineString, destination {lat,lng}, destinationName, mode, distanceM, durationS}` |
| POST | `/journey/end` | T | `{arrived: boolean}` |
| GET | `/overview` | O | active + missed check-ins, active + overdue journeys |
| GET / POST | `/broadcasts` | O | history / send `{title, message, severity info|warning|critical, target all|zone, zoneId?}` |

`POST /api/tourists/location` now also returns `journey: { event: null|deviation|back_on_route|arrived, distanceFromRouteM, toDestinationM }` when a journey is active.

## Operator `/api/admin` (O)
`GET /stats` · `GET /reports/summary?from&to` · `GET /reports/export?type=incidents|alerts|tourists&from&to` (CSV) · `GET /audit?action&role&from&to&page` · `GET /notifications?status&channel&page` · `GET /system` · `GET|POST /operators` · `GET /risk/models` · `POST /risk/train` · `GET /risk/predict?lat&lng&at`

## Health
`GET /api/health` → `{ ok, database, blockchain: {ok, chainId, blockNumber}|{ok:false,error} }` (503 if the database is down)

## Socket.IO
Connect with `io({ auth: { token } })`. The server verifies the token and account, then joins `user:<id>` and, for operators, `admins`. Clients cannot join rooms.

| Event | To | Payload |
|---|---|---|
| `location:update` | operators | userId, name, lat, lng, accuracy, source, timestamp, zoneId, zoneName, zoneType, zoneConfidence, trackingActive |
| `location:self` | the tourist | same |
| `alert` | operators and/or the tourist | Alert document with `id`, `timestamp`, kind, severity, title, message, touristMessage |
| `alert:reviewed` | operators | id, reviewedAt |
| `incident` | operators + the tourist | populated incident (tourists never receive operator notes) |
| `incident:chain` | operators | _id, chainStatus, chainHash?, chainTxHash? |
| `zones:changed` | everyone | {} |
| `tourist:status` | operators | userId, online? / trackingActive? |
| `session:revoked` | the user | reason (client logs out) |
| `checkin:update` | operators | SafetyCheckIn document |
| `journey:update` | operators | Journey (without the route geometry) |
| `journey:self` | the tourist | Journey + toDestinationM |
| `broadcast` | operators | Broadcast document |
