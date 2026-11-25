# TourSafe AI

**Smart Tourist Safety Monitoring and Incident Response System Using Geo-Fencing and Blockchain-Based Digital Identity**
*(MCA project)*

TourSafe AI is a web application that connects **tourists** with a city **control room** (operators such as police or tourist-help staff).

- Tourists **register on the website**, get a **Digital ID with a QR code**, and can **share their live location** from their phone or laptop browser.
- The system knows the city's **safe (green), caution (yellow) and restricted (red) zones**. When a tourist walks into a caution or restricted zone, the tourist **and** the control room get an alert immediately.
- In an emergency the tourist presses **SOS**. The control room sees it at once, assigns an officer, and follows it until it is resolved.
- The tourist's identity and every incident are **fingerprinted (SHA-256) and stored on a blockchain**, so an officer can scan the QR code to verify the ID, and anyone can prove that an incident record has not been secretly edited.

> TourSafe supports the authorities; it does not replace them. In a real emergency always call **112** (India) or your local emergency number.

---

## Table of contents

1. [What problem does it solve?](#1-what-problem-does-it-solve)
2. [Features](#2-features)
3. [How the system is built (architecture)](#3-how-the-system-is-built-architecture)
4. [Technology used](#4-technology-used)
5. [Folder structure](#5-folder-structure)
6. [Requirements (install these first)](#6-requirements-install-these-first)
7. [Step-by-step: run the project on your computer](#7-step-by-step-run-the-project-on-your-computer)
8. [Using the website: tourist guide](#8-using-the-website-tourist-guide)
9. [Using the website: operator (control room) guide](#9-using-the-website-operator-control-room-guide)
10. [Workflows explained step by step](#10-workflows-explained-step-by-step)
11. [Configuration (`backend/.env`)](#11-configuration-backendenv)
12. [Database collections](#12-database-collections)
13. [API and real-time events](#13-api-and-real-time-events)
14. [Blockchain part explained](#14-blockchain-part-explained)
15. [Security](#15-security)
16. [Automated tests](#16-automated-tests)
17. [Production deployment](#17-production-deployment)
18. [Troubleshooting](#18-troubleshooting)
19. [Limitations and future work](#19-limitations-and-future-work)
20. [Glossary](#20-glossary)

---

## 1. What problem does it solve?

Tourists in an unfamiliar city do not know which areas are risky, often cannot explain where they are in an emergency, and local authorities have no live picture of where tourists are. Paper IDs can be forged, and incident records can be changed afterwards.

TourSafe AI gives:

| Who | Gets |
|---|---|
| **Tourist** | Live safety status, warnings when entering risky areas, one-tap SOS that sends the exact location, nearby police/hospitals, safer routes, a check-in timer, and a verifiable Digital ID |
| **Control room** | A live map of all tourists who share their location, instant alerts, an incident workflow, ID verification by QR code, tamper-proof records, reports |

---

## 2. Features

### For tourists
| Feature | Description |
|---|---|
| Registration | Name, email, strong password, phone, nationality, ID document, trip dates, emergency contact. Everything is validated. |
| Digital ID + QR code | A blockchain-registered fingerprint of your identity. An officer scans the QR to verify you. No personal data is inside the QR. |
| Live location sharing | Uses the browser's location (GPS / Wi-Fi / mobile network). Shows accuracy and last update time. Start / Stop at any time; stops when you log out; resumes after a page reload. |
| Safety status | "Safe / Caution / Restricted / Outside zones" for where you are right now. |
| Zone alerts | Pop-up when you enter a caution or restricted zone (once per entry, not every few seconds). Inaccurate locations never trigger false alerts. |
| Live map | Safety zones, your position with an accuracy circle, your route history, your incidents, nearby police stations and hospitals, layer switcher and legend. |
| Nearby help | Police stations and hospitals from OpenStreetMap with distance, phone (if known) and directions. |
| Safe route | Search a destination (or click on the map) and get walking / driving / cycling routes, ranked by which risk zones they pass through. |
| Journey monitoring | "Start journey" on a planned route: the control room is told if you leave the route or do not arrive on time; it stops automatically when you arrive. |
| Safety check-in timer | "Check on me in 30 minutes". If you do not tap **I'm safe** in time, the control room and your emergency contact are alerted. |
| SOS | Big SOS button with a confirmation step. Sends your live (or last known) location, an optional message, and the address. Repeat presses within 30 s are ignored. You can cancel a false alarm before an officer is assigned. |
| Offline SOS | With no internet, the SOS is saved on the phone and sent automatically when the connection comes back. A "Call 112" button is shown meanwhile. |
| Notifications | All alerts, advisories from the control room, and the status of every email/SMS sent about you. |
| Profile & settings | Edit contact details, emergency contact, notification preferences; change password; log out on all devices. |
| Forgot password | Reset link by email (valid 30 minutes, usable once). |

### For operators (control room)
| Feature | Description |
|---|---|
| Dashboard | Live numbers from the database: registered tourists, tracked now, in caution/restricted zones, open/resolved incidents, alerts, check-ins, journeys, blockchain status. |
| Live monitoring | Map of every tourist who shares a location, coloured by status: SOS, restricted, caution, safe, stale, offline. Search and filter. |
| Incident manager | Search, filter by status/type/date, map, details, assign officer, add notes, resolve (or mark false alarm), full history, blockchain integrity check. Two operators cannot overwrite each other. |
| Zone manager | Draw new zones (polygon or rectangle), edit name/type/description/source and the shape, delete. Invalid shapes are rejected. |
| Tourists | Search, details, location history on a map with date filter, suspend / re-activate accounts. |
| Safety & advisories | Send an advisory to all tourists or only tourists inside a chosen zone; watch running check-in timers and monitored journeys. |
| ID verification | Scan a QR code with the camera (or from an image) or paste the ID; result VALID / REVOKED / EXPIRED / TAMPERED / UNKNOWN / BLOCKCHAIN UNAVAILABLE; revoke an ID with a reason; revocation history. |
| Blockchain | Node health, contract address, proof counts (pending / confirmed / failed), retry button, incident integrity check by id. |
| Reports & logs | Summary for a date range, incidents per day, most-entered risk zones, CSV export, operator activity (audit) log, email/SMS history. |
| Settings | Which services are configured, operator accounts, experimental AI risk model. |
| Anomaly review | Automatic "please review" alerts: implausible movement, location updates stopped, long stay in a restricted zone, off planned route, journey overdue, missed check-in. |

---

## 3. How the system is built (architecture)

```
  Tourist's browser (phone/laptop)              Operator's browser
  React app: maps, SOS, Digital ID              React app: control room
        │   ▲                                         │   ▲
        │   │ REST (HTTPS JSON)   +   Socket.IO (live push)
        ▼   │                                         ▼   │
  ┌───────────────────────────────────────────────────────────────┐
  │                  Backend: Node.js + Express 5                   │
  │  auth · tracking · geofence (Turf.js) · alerts · incidents      │
  │  safety tools · notifications · reports · audit · risk model    │
  └──────┬───────────────────┬───────────────────────┬─────────────┘
         │                   │                       │
         ▼                   ▼                       ▼
   MongoDB database   Ethereum blockchain       External services
   (all real data)    TouristRegistry contract  OpenStreetMap tiles, Nominatim
                      (only SHA-256 hashes)     (addresses), Overpass (police/
                                                hospitals), OSRM (routes),
                                                SMTP email, Twilio SMS (optional)
```

- The **frontend** (React) runs in the browser. During development Vite serves it on port **5173** and forwards `/api` and `/socket.io` to the backend.
- The **backend** (Express) runs on port **5000**. It checks every request (login token, role), stores data in **MongoDB**, pushes live updates with **Socket.IO**, and writes proofs to the **blockchain**.
- The **blockchain** for development is a local **Hardhat** node on port **8545**. Only hashes go there, never personal data.

---

## 4. Technology used

| Layer | Technology | Used for |
|---|---|---|
| Frontend | React 18, Vite 5, React Router 6 | User interface, pages, navigation |
| Maps | Leaflet, React-Leaflet, Leaflet.draw, OpenStreetMap tiles | Maps, drawing zones |
| QR | qrcode (backend), html5-qrcode (frontend) | Create and scan Digital ID QR codes |
| Real time | Socket.IO | Live locations, alerts, incident updates |
| Backend | Node.js 22+, Express 5 | REST API |
| Database | MongoDB + Mongoose 8 | Users, locations, zones, incidents, alerts, logs |
| Security | JWT, bcryptjs, Helmet, express-rate-limit | Login, password hashing, security headers, rate limiting |
| Geo | Turf.js, GeoJSON | Point-in-zone checks, distances, route analysis |
| Blockchain | Solidity 0.8.24, Hardhat, ethers.js v6 | `TouristRegistry` smart contract |
| Notifications | nodemailer (SMTP), Twilio REST | Email and SMS (optional) |
| Tests | Node test runner, Supertest, Vitest, Testing Library, Hardhat/Chai | Automated tests |

---

## 5. Folder structure

```
tourist-safety/
├── package.json              Root scripts: install-all, chain, setup, dev, test, build, start
├── README.md                 This file
├── docs/
│   ├── API.md                Every REST endpoint and Socket.IO event
│   ├── SECURITY.md           Security review and deployment hardening
│   ├── STATUS.md             What is done / tested / not done
│   └── AUDIT.md              Audit of the original version and what changed
│
├── backend/                  Node.js + Express API
│   ├── .env.example          All settings with explanations (copy to .env)
│   ├── server.js             Starts HTTP server + Socket.IO + background workers
│   ├── app.js                Builds the Express app (security, routes, error handling)
│   ├── config.js             Reads and validates environment variables
│   ├── db.js                 MongoDB connection
│   ├── socket.js             Socket.IO: authentication, rooms, events
│   ├── middleware/
│   │   ├── auth.js           JWT login check, role check, account status
│   │   └── security.js       Input sanitising, rate limits
│   ├── models/               MongoDB collections (see section 12)
│   ├── routes/               API endpoints
│   │   ├── auth.js           register, login, profile, password change/reset, logout
│   │   ├── tourist.js        location updates, tracking on/off, tourist management
│   │   ├── zones.js          safety zones CRUD
│   │   ├── incidents.js      SOS and incident workflow
│   │   ├── verify.js         Digital ID QR, verification, revocation, incident integrity
│   │   ├── geo.js            nearby places, routes, address search
│   │   ├── safety.js         check-in timer, journeys, advisories
│   │   └── admin.js          dashboard stats, reports, CSV, audit log, settings, risk model
│   ├── services/             Business logic
│   │   ├── tracking.js       location pipeline (zone check, save, alerts, push)
│   │   ├── geofence.js       Turf.js zone detection with accuracy awareness
│   │   ├── alerts.js         saves and pushes alerts
│   │   ├── notify.js         email / SMS sending with history
│   │   ├── blockchain.js     talks to the smart contract
│   │   ├── chainProofs.js    pending → confirmed / failed lifecycle + retry worker
│   │   ├── safety.js         check-ins, journeys, advisories, sweeper
│   │   ├── anomaly.js        unusual movement detection
│   │   ├── geo.js            OpenStreetMap Overpass / Nominatim / OSRM
│   │   ├── risk.js           experimental decision-tree risk model
│   │   └── audit.js          operator activity log
│   ├── utils/                validation, hashing, helpers
│   ├── seed/
│   │   ├── seed.js           first-time setup (npm run setup)
│   │   ├── createAdmin.js    create an operator account
│   │   └── syncChain.js      re-write proofs after a blockchain restart
│   └── test/                 unit + end-to-end tests
│
├── frontend/                 React app
│   ├── vite.config.js        dev server (port 5173) + proxy to backend
│   └── src/
│       ├── App.jsx           all routes (pages)
│       ├── api.js            calls to the backend
│       ├── AuthContext.jsx   login state
│       ├── SocketContext.jsx live connection
│       ├── tracking/         browser location tracking
│       ├── layouts/          public / tourist / operator layouts
│       ├── components/       maps, cards, dialogs, toasts, QR scanner…
│       ├── pages/public/     landing, about, features, help, login, register, password reset
│       ├── pages/tourist/    dashboard, live map, SOS, safety tools, Digital ID, incidents, notifications, profile
│       ├── pages/operator/   dashboard, monitoring, incidents, zones, tourists, safety, verify, blockchain, reports, settings
│       └── test/             frontend tests
│
└── blockchain/               Hardhat project
    ├── contracts/TouristRegistry.sol   the smart contract
    ├── scripts/deploy.js               deploys it and writes deployment.json
    ├── test/                           contract tests
    └── hardhat.config.js
```

---

## 6. Requirements (install these first)

| Software | Version | Download | Check it works |
|---|---|---|---|
| **Node.js** (includes npm) | 22 or newer | https://nodejs.org (choose "LTS") | `node -v` and `npm -v` |
| **MongoDB Community Server** | 6 or newer | https://www.mongodb.com/try/download/community | `mongosh --eval "db.runCommand({ping:1})"` should print `{ ok: 1 }` |
| **Git** | any | https://git-scm.com | `git --version` |
| A modern browser | Chrome, Edge, Firefox | | |
| Internet connection | | | needed for map tiles, routes, addresses, police/hospital data |

**Starting MongoDB**
- **Windows:** the installer creates a Windows service called *MongoDB Server*; it starts automatically. (Services app → MongoDB Server → Start, if needed.)
- **macOS (Homebrew):** `brew tap mongodb/brew && brew install mongodb-community && brew services start mongodb-community`
- **Linux (Ubuntu):** follow the MongoDB install guide, then `sudo systemctl start mongod`

`mongosh` (the MongoDB shell) is optional but handy to check the database is running: https://www.mongodb.com/try/download/shell

---

## 7. Step-by-step: run the project on your computer

You will use **three terminal windows** (Command Prompt / PowerShell / Terminal). All commands are run from the project folder.

### Step 1: Get the code
```bash
git clone https://github.com/Rahul022-rj/Tour_Safe_AI.git
cd Tour_Safe_AI
```

### Step 2: Install all dependencies
```bash
npm run install-all
```
This installs packages for the root, `backend`, `frontend` and `blockchain` folders (takes a few minutes the first time).

### Step 3: Create the configuration file
```bash
# Windows (Command Prompt)
copy backend\.env.example backend\.env
# macOS / Linux / Git Bash / PowerShell
cp backend/.env.example backend/.env
```
Open `backend/.env` in a text editor and set **`JWT_SECRET`** to a long random text. You can generate one with:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```
Everything else can stay as it is for a first run. (Section 11 explains every setting.)

### Step 4: Make sure MongoDB is running
```bash
mongosh --eval "db.runCommand({ ping: 1 })"
```
You should see `{ ok: 1 }`.

### Step 5: Start the blockchain (terminal 1, keep it open)
```bash
npm run chain
```
You will see a list of test accounts and `Started HTTP and WebSocket JSON-RPC server at http://127.0.0.1:8545/`. **Leave this window open.**

### Step 6: Compile and deploy the smart contract (terminal 2)
```bash
npm run chain:compile
npm run chain:deploy
```
Expected: `TouristRegistry deployed to 0x5FbDB2315678afecb367f032d93F642f64180aa3 (chain 31337 …)`.

### Step 7: First-time setup (terminal 2)
Create the safety zones, sample police/hospital records and **your operator account**:
```bash
npm run setup -- --admin-email you@example.com --admin-password "Your!Str0ngPass1" --admin-name "Control Room"
```
- The password must have 8+ characters with upper case, lower case, a digit and a symbol.
- Without arguments (`npm run setup`) it creates the development login `admin@demo.com` / `Admin@123`; change that password later in *Settings*.
- Running setup again is safe: it only adds what is missing and never deletes users.
- No tourists are created: tourists register themselves on the website.

### Step 8: Start the application (terminal 2, keep it open)
```bash
npm run dev
```
This starts:
- the **backend** on http://localhost:5000 (health check: http://localhost:5000/api/health)
- the **website** on **http://localhost:5173**

### Step 9: Open the website
Open **http://localhost:5173** in your browser.
- Click **Register** to create a tourist account (section 8).
- Click **Log in** and use your operator email/password for the control room (section 9).

Tip: use two different browsers (or a normal + a private window) to be a tourist and an operator at the same time and watch alerts appear live.

### Step 10 (optional): Run the automated tests (terminal 3)
```bash
npm test
```
MongoDB must be running. The tests start their own blockchain on port 8546 and use a separate test database, so your data is not touched.

### Stopping and starting again
- Stop: press **Ctrl + C** in each terminal.
- Next time: `npm run chain` (terminal 1), then `npm run chain:deploy` and `npm run chain:sync` (terminal 2), then `npm run dev`.
  The local blockchain forgets everything when it stops; `chain:sync` writes all Digital IDs and incident proofs from MongoDB back onto the fresh chain. Your users and data in MongoDB are kept.

### All commands at a glance
| Command | What it does |
|---|---|
| `npm run install-all` | Install all dependencies |
| `npm run chain` | Start the local blockchain (keep open) |
| `npm run chain:compile` | Compile the smart contract |
| `npm run chain:deploy` | Deploy the contract to the local blockchain |
| `npm run chain:sync` | Re-write proofs after restarting the blockchain |
| `npm run setup` | First-time setup (zones, sample stations, operator) |
| `npm run setup -- --reset --yes` | **Delete all data** and set up again (development only) |
| `npm run create-admin -- --name "Name" --email a@b.com --password "Str0ng!Pass"` | Add another operator |
| `npm run dev` | Start backend + website for development |
| `npm test` | Run all automated tests |
| `npm run build` | Build the website for production |
| `npm start` | Start the backend (serves the built website when `NODE_ENV=production`) |

---

## 8. Using the website: tourist guide

1. **Register** (http://localhost:5173/register)
   Fill in: full name, email, password (twice), mobile phone, nationality, ID document type and number, trip start and end dates, emergency contact (name, phone, optional email), and tick the consent box. If something is wrong, the field is highlighted and the page jumps to it. After registering you are logged in automatically.
2. **Dashboard**: shows your safety status, SOS button, location sharing, check-in timer, journey, Digital ID status, open incidents, latest notifications and an experimental area risk indication.
3. **Start sharing your location**: press **Start sharing location** and allow location when the browser asks. You will see the accuracy (e.g. ± 15 m) and the time of the last update. Your position is sent about every 5 seconds. Press **Stop sharing** at any time. Logging out also stops it.
4. **Live map & routes**: see zones (green / yellow / red), yourself (blue dot + accuracy circle), your route history and your incidents.
   - *Nearby help* tab: police stations and hospitals near you, with distance, phone and directions.
   - *Safe route* tab: search a place or press *Pick on map*, choose walking/driving/cycling, press **Get safe route**. Routes are listed safest first with warnings. Press **Start journey with the selected route** to have the control room watch your journey.
5. **Safety tools**: start a **check-in timer** (15 min, 30 min, 1 h, 2 h or custom) before going somewhere alone; tap **I'm safe** before it ends. See your journey and advisories from the control room.
6. **Emergency SOS**: press **SOS**, optionally type what is happening, press **Yes, send SOS**. The control room gets your location and message immediately. You see the status (Reported → Assigned → Resolved) and who is handling it. While it is still *Reported* you can **cancel a false alarm**. Without internet the SOS is queued and sent automatically later.
7. **Digital ID**: your QR code and verification status (should say **VALID**). Download it or show it on screen to an officer.
8. **My incidents** / **Notifications**: history of your SOS requests, alerts, advisories, and email/SMS delivery status.
9. **Profile & settings**: change phone, emergency contact, notification preferences, password; log out on all devices. Name, email, ID number and trip dates cannot be changed because they are part of your Digital ID fingerprint.

> Location in the browser only works on **https://** addresses or on **localhost**. On a desktop without GPS the location may be off by hundreds of metres; this is normal and the app shows the accuracy.

---

## 9. Using the website: operator (control room) guide

Log in with the operator account created in step 7.

1. **Dashboard**: all key numbers, a live map that zooms to where tourists are, open incidents and recent alerts. An SOS shows a red pop-up (with a short beep) until dismissed.
2. **Live monitoring**: big map + list of tourists. Colours: red ring = SOS, red = restricted zone, orange = caution, green = safe, grey = stale (no update for 1 min), dark grey = offline (stopped sharing / logged out). Click a tourist for details. The *Alerts* tab shows all alerts; anomaly alerts have a **Mark reviewed** button.
3. **Incidents**: filter (Open / Reported / Assigned / Resolved / All), type, search text, date range. Click an incident to:
   - **Assign** an officer or unit (e.g. "Patrol Car 12"), with an optional note,
   - add **notes**,
   - **Mark resolved** (or false alarm),
   - **Verify integrity** on the blockchain.
4. **Zone manager**: draw with the polygon or rectangle tool (top-left of the map), give a name, type (red/yellow/green), description and the source of the risk information, and save. Click a zone to edit it; **Edit shape on map** lets you drag its corners. Delete zones that are no longer valid.
5. **Tourists**: search and open a tourist to see profile, location history (filter by date), incidents and alerts; **Suspend** an account if needed (the tourist is logged out everywhere).
6. **Safety & advisories**: send an advisory to all tourists or only those in a zone (e.g. "Heavy crowd at Charminar"); see running check-in timers and monitored journeys.
7. **ID verification**: **Scan QR code** (camera or image file) or paste `TSID:0x…`; read the verdict and checks; **Revoke this ID** with a reason; see revocation history.
8. **Blockchain**: node status, contract address, proof counts, **Retry failed / pending proofs now**, incident integrity check by incident id.
9. **Reports & logs**: summary for a date range, CSV exports (incidents, alerts, tourists), operator activity log, email/SMS history.
10. **Settings**: which services are configured (email, SMS, blockchain, maps), add operator accounts, train the experimental risk model, change your password.

---

## 10. Workflows explained step by step

### 10.1 Registration and Digital ID
1. The tourist submits the form; the browser checks it first, then the server checks everything again.
2. The password is hashed with **bcrypt** (never stored in plain text).
3. A random **salt** is created and the **Digital ID hash** is computed: `SHA-256(name | email | ID number | trip start | trip end | salt)`.
4. The user is saved in MongoDB with ID status **pending**, and the tourist is logged in (a JWT token is returned).
5. In the background the hash is sent to the smart contract (`registerID`). When the transaction is confirmed the status becomes **confirmed** and the tourist gets a "Digital ID confirmed" notification. If the blockchain is down, it is retried every 30 seconds; the ID is not shown as VALID until it is on the chain.

### 10.2 Live location and geo-fencing
1. The browser calls `navigator.geolocation.watchPosition` (options: high accuracy, max age 5 s, timeout 20 s).
2. At most every 5 seconds it sends `{lat, lng, accuracy}` to `POST /api/tourists/location`.
3. The server validates the numbers and refuses updates faster than every 2 seconds.
4. **Turf.js** checks which zone polygons contain the point. If zones overlap, the most dangerous wins (red > yellow > green).
5. If the accuracy is worse than 100 m, or the accuracy circle crosses a zone border, the reading is marked **uncertain** and never triggers an alert.
6. The position is saved (history is kept 30 days), and pushed live to the operators' map and the tourist's own screen.
7. If the tourist **entered** a new yellow or red zone with a confident reading, an alert is created (saved in MongoDB, shown as a pop-up to tourist and operators) and email/SMS are sent if configured (at most once per zone per 10 minutes).
8. If a journey is active, the distance to the planned route and the destination is checked too (10.5).

### 10.3 SOS and incident handling
1. Tourist presses **SOS** → confirms.
2. The server takes an **SOS lock** in MongoDB (prevents duplicates for 30 s, even with several servers).
3. Location: the live position sent with the SOS, otherwise the last known one. Without any location the tourist is told to allow location or call 112.
4. The incident is saved with status **Reported**, and operators get a critical alert immediately.
5. **After** that (never delaying the SOS): the address is looked up, email/SMS go to the emergency contact, and the incident fingerprint is written to the blockchain.
6. An operator **assigns** an officer → status **Assigned** → the tourist is notified.
7. The operator **resolves** it → status **Resolved**. Every step is in the history, every change gets a new blockchain proof, and two operators editing at once get a conflict message instead of overwriting each other.

### 10.4 Safety check-in timer
1. The tourist starts a timer (5-720 minutes) with an optional note.
2. A background job runs every 30 seconds. If the deadline passed without **I'm safe**, the check-in becomes **missed**: operators get a high-priority alert, the emergency contact gets SMS/email, the tourist gets a reminder.
3. A late **I'm safe** tells the control room the tourist is fine.

### 10.5 Journey monitoring
1. The tourist plans a route (OSRM) and presses **Start journey**; the route line, destination and expected arrival time are saved.
2. On each location update the distance from the route is measured. Only **3 accurate readings in a row** more than 150 m away raise **one** "off planned route (review)" alert; returning to the route resets it.
3. Coming within 60 m of the destination ends the journey as **arrived**.
4. If the tourist has not arrived by the expected time plus a grace period, an **overdue** alert is raised.

### 10.6 Advisories (broadcasts)
The operator writes a title + message, picks severity and target (all tourists, or one zone). For a zone, the server checks which tourists' last location in the past hour is inside the zone polygon. Each recipient gets a pop-up and a notification entry.

### 10.7 Digital ID verification (QR)
1. The QR contains only `TSID:` + the hash.
2. The officer scans it; the server finds the tourist, recomputes the hash from the stored details, and asks the blockchain whether it is registered and not revoked.
3. Verdicts: **VALID**, **UNKNOWN ID**, **TAMPERED** (details changed), **REVOKED**, **EXPIRED** (trip ended), **NOT ON BLOCKCHAIN** (registration still pending), **BLOCKCHAIN UNAVAILABLE** (never VALID without a chain check).
4. Revocation: marked in the database immediately and written to the blockchain (`revokeID`).

### 10.8 Incident integrity
After every change, the incident is converted to a **canonical JSON** (sorted keys, ISO dates, rounded coordinates), hashed with SHA-256 and logged on chain. *Verify integrity* recomputes the hash: **INTACT** (matches the latest proof on chain), **TAMPERED** (the record was edited or rolled back outside the app), **PENDING**, **NOT CONFIRMED**, **NOT SUBMITTED**, **PROOF UNAVAILABLE** (chain was reset), **BLOCKCHAIN UNAVAILABLE**.

### 10.9 Offline SOS
If the SOS request cannot reach the server, it is stored on the device, the screen clearly says it is **not delivered yet** and shows **Call 112 now**. It is retried when the browser comes back online and every 15 seconds for up to 30 minutes, and marked "queued offline" when it arrives.

### 10.10 Anomaly detection (operator review only)
- Two consecutive implausible jumps (> 200 km/h with accurate readings)
- Tracking switched on but no update for 30 minutes
- More than 10 minutes inside a restricted zone
- Off planned route, journey overdue, missed check-in

These never declare an emergency by themselves; an operator reviews them.

### 10.11 Experimental AI risk model
A decision tree predicts "will an SOS be reported in this ~1 km area in this 3-hour window", trained only on this system's own history with a time-based split (no data leakage), reporting precision, recall, F1 and a confusion matrix. With too little data it refuses to train and the app shows a clearly labelled simple rule-based indication instead. It is advisory only.

---

## 11. Configuration (`backend/.env`)

Copy `backend/.env.example` to `backend/.env`. **Never upload `.env` to GitHub** (it is in `.gitignore`).

| Variable | Default | Meaning |
|---|---|---|
| `NODE_ENV` | development | `production` turns on strict checks |
| `PORT` | 5000 | Backend port |
| `MONGODB_URI` | mongodb://127.0.0.1:27017/tourist_safety | Database (use 127.0.0.1 on Windows) |
| `JWT_SECRET` | *(required)* | Secret for login tokens (32+ chars in production) |
| `JWT_EXPIRES_IN` | 8h | How long a login lasts |
| `CLIENT_URL` | http://localhost:5173 | Website address (CORS + reset links) |
| `CORS_EXTRA_ORIGINS` | | Extra allowed website addresses, comma separated |
| `TRUST_PROXY` | false | `true` behind nginx / a load balancer |
| `BCRYPT_ROUNDS` | 12 | Password hashing cost |
| `PASSWORD_RESET_MINUTES` | 30 | Reset link validity |
| `BLOCKCHAIN_RPC_URL` | http://127.0.0.1:8545 | Blockchain node |
| `CHAIN_ID` | 31337 | Blockchain network id (31337 = local Hardhat) |
| `CONTRACT_ADDRESS` | | Empty = read from `blockchain/deployment.json` |
| `PRIVATE_KEY` | | Signing key; empty = Hardhat test account (local only) |
| `CHAIN_CONFIRMATIONS`, `CHAIN_TX_TIMEOUT_MS`, `CHAIN_RETRY_INTERVAL_MS`, `CHAIN_MAX_ATTEMPTS` | 1, 60000, 30000, 10 | Transaction waiting and retries |
| `REQUIRE_CHAIN_FOR_ID` | true | ID is VALID only after on-chain confirmation |
| `LOCATION_RETENTION_DAYS` | 30 | Location history is deleted automatically after this |
| `MIN_LOCATION_INTERVAL_MS` | 2000 | Fastest allowed location updates per tourist |
| `GEOFENCE_MAX_ACCURACY_M` | 100 | Worse readings never trigger zone alerts |
| `STALE_AFTER_MS`, `OFFLINE_AFTER_MS` | 60000, 600000 | When a tourist shows as stale / offline |
| `SOS_COOLDOWN_MS` | 30000 | Duplicate SOS protection |
| `ANOMALY_MAX_SPEED_KMH`, `ANOMALY_INACTIVITY_MIN`, `ANOMALY_RESTRICTED_DWELL_MIN`, `ANOMALY_SWEEP_MS` | 200, 30, 10, 60000 | Anomaly rules |
| `ROUTE_DEVIATION_M`, `ROUTE_DEVIATION_READINGS`, `ARRIVAL_RADIUS_M`, `JOURNEY_OVERDUE_GRACE_MIN`, `SAFETY_SWEEP_MS` | 150, 3, 60, 15, 30000 | Journey and check-in rules |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | | Email provider (Gmail app password, SendGrid, Mailgun, SES…) |
| `NOTIFY_COOLDOWN_MS` | 600000 | Same zone alert at most once per 10 min per person |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | | SMS provider |
| `OSRM_URL`, `NOMINATIM_URL`, `OVERPASS_URLS` | public OpenStreetMap services | Routing, addresses, police/hospital data |
| `EXTERNAL_USER_AGENT` | TourSafe-AI/1.0 | Identifies the app to those services |
| `DISABLE_EXTERNAL_APIS` | false | Turn off all external map services |
| `SETUP_ADMIN_EMAIL`, `SETUP_ADMIN_PASSWORD`, `SETUP_ADMIN_NAME` | | Alternative to the `npm run setup` arguments |

**Email/SMS without credentials:** the app still works; each message is recorded as **not configured** and is never shown as "sent".
**Password reset without email:** in development the reset link is printed in the backend terminal.

---

## 12. Database collections

| Collection | Stores |
|---|---|
| `users` | Tourists and operators: login data (hashed password), profile, emergency contact, Digital ID hash + chain status, last location and zone, tracking state |
| `locations` | Every location update (point, accuracy, zone, confidence, time); auto-deleted after 30 days |
| `zones` | Safety zones as GeoJSON polygons with type, description, source |
| `incidents` | SOS incidents: location, address, status, assigned officer, history, notes, revision, latest proof |
| `alerts` | Every alert/notification shown in the app |
| `notifications` | Every email/SMS attempt and its real result (sent / failed / not configured / skipped) |
| `chainproofs` | Every blockchain write: hash, status (pending / submitted / confirmed / failed), transaction, attempts |
| `safetycheckins` | Check-in timers |
| `journeys` | Monitored journeys (planned route, destination, status) |
| `broadcasts` | Advisories sent by operators |
| `soslocks` | Short-lived duplicate-SOS protection |
| `auditlogs` | Who did what and when (kept 1 year) |
| `stations` | Police stations / hospitals (OpenStreetMap cache + sample records marked DEMO) |
| `riskmodels` | Trained versions of the experimental risk model with their metrics |

Coordinates are stored as GeoJSON `[longitude, latitude]`; maps use `[latitude, longitude]`. The code converts between them in one place (`frontend/src/utils.js`).

---

## 13. API and real-time events

The full list is in **[docs/API.md](docs/API.md)**. Main groups:

| Base path | Purpose |
|---|---|
| `/api/auth` | register, login, me, profile, change/forgot/reset password, logout |
| `/api/tourists` | location updates, tracking on/off, own history & notifications; operator search, details, history, suspend |
| `/api/zones` | safety zones |
| `/api/incidents` | SOS, list/search, details, status changes, notes, cancel |
| `/api/verify` | Digital ID QR, verification, revocation, incident integrity, blockchain status |
| `/api/geo` | nearby places, routes, address search, risk indication |
| `/api/safety` | check-in timer, journeys, advisories, overview |
| `/api/admin` | dashboard stats, reports, CSV export, audit log, notification history, system status, operators, risk model |
| `/api/health` | database + blockchain health |

Live events (Socket.IO): `location:update`, `location:self`, `alert`, `incident`, `incident:chain`, `zones:changed`, `tourist:status`, `checkin:update`, `journey:update`, `journey:self`, `broadcast`, `session:revoked`. Each browser only receives events meant for it (operators' room or the tourist's own private room).

---

## 14. Blockchain part explained

**Smart contract:** `blockchain/contracts/TouristRegistry.sol`

| Function | Purpose |
|---|---|
| `registerID(bytes32 idHash)` | Store a Digital ID fingerprint |
| `verifyID(bytes32 idHash)` | true if registered and not revoked |
| `revokeID(bytes32 idHash)` | Mark an ID as revoked |
| `logIncident(bytes32 hash)` | Store an incident fingerprint with the block time |
| `registered`, `revoked`, `incidentLoggedAt` | Read the stored values |

Only the contract owner (the backend's account) can write. **Only hashes are stored on chain**: no names, emails, phone numbers, ID numbers or locations.

**Development chain:** Hardhat (`npm run chain`), chain id 31337, in memory. Restarting it erases the chain; run `npm run chain:deploy` and `npm run chain:sync` afterwards.

**Persistent network (e.g. a testnet):**
```bash
# deploy (keys only via environment variables, never in files you commit)
DEPLOY_RPC_URL=https://... DEPLOY_PRIVATE_KEY=0x... npm run deploy:custom --prefix blockchain
```
Then in `backend/.env` set `BLOCKCHAIN_RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS` and `PRIVATE_KEY`.

---

## 15. Security

- Passwords hashed with bcrypt; strong password rule; same error for "wrong password" and "unknown email".
- Login tokens (JWT, 8 h). Changing/resetting the password, suspension or "log out everywhere" invalidates old tokens immediately.
- Every API checks the role on the server: a tourist calling an operator API gets **403**, and tourists can only see their own data.
- Rate limits on login, registration, password reset, map lookups and the whole API.
- Input validation, removal of MongoDB operators from input, 200 kB request limit.
- Helmet security headers with Content-Security-Policy, strict CORS.
- Audit log of logins, failed logins and every operator action.
- No passwords, tokens, ID numbers or keys in logs or exports.
- Startup refuses an insecure configuration in production.

Details and remaining limitations: **[docs/SECURITY.md](docs/SECURITY.md)**.

---

## 16. Automated tests

```bash
npm test                         # everything (contract, backend, frontend)
npm test --prefix blockchain     # smart contract (7 tests)
npm test --prefix backend        # backend unit + end-to-end (46 tests)
npm test --prefix frontend       # frontend (20 tests)
```

The backend end-to-end tests use a **real MongoDB test database, a real Hardhat blockchain (port 8546) and real Socket.IO clients**. They cover the 10 required workflows:

| Test | Workflow |
|---|---|
| TEST 1 | Register → log in → Digital ID on chain → QR verifies VALID |
| TEST 2 | Location sent → saved in MongoDB → shown on operator map |
| TEST 3 / 4 | Enter yellow zone / red zone → one alert each |
| TEST 5 | SOS → incident → operator notified → assign → resolve (+ duplicate protection) |
| TEST 6 | Edit an incident in the database → integrity check says TAMPERED |
| TEST 7 | Revoke Digital ID → scan → REVOKED |
| TEST 8 | Blockchain stopped → SOS still works |
| TEST 9 | Tourist calls operator API → 403 |
| TEST 10 | Socket disconnect/reconnect → no duplicate events, no leaks between users |

Plus: password reset, suspension, IDOR protection, zone validation, check-in timer, journey off-route/arrival/overdue, advisories, offline SOS queue, location tracker behaviour, map rendering.

---

## 17. Production deployment

1. Server with Node.js 22+, MongoDB (with authentication), and HTTPS (e.g. nginx or Caddy with a certificate). **HTTPS is required** for location and camera on phones.
2. `backend/.env`: `NODE_ENV=production`, a strong `JWT_SECRET`, `CLIENT_URL=https://your-domain`, `TRUST_PROXY=true`, MongoDB URI with user/password, email/SMS credentials, a persistent blockchain (`BLOCKCHAIN_RPC_URL`, `CHAIN_ID`, `CONTRACT_ADDRESS`, `PRIVATE_KEY`).
3. Build and start:
   ```bash
   npm run install-all
   npm run build
   npm run setup -- --admin-email ops@your-domain --admin-password "…"
   NODE_ENV=production npm start          # PowerShell: $env:NODE_ENV="production"; npm start
   ```
   The backend serves the website and the API on one port; put it behind the HTTPS proxy.
4. Read **[docs/SECURITY.md](docs/SECURITY.md)** before going live.

---

## 18. Troubleshooting

| Problem | Solution |
|---|---|
| `npm` or `node` not found | Install Node.js 22+ and open a new terminal |
| `Could not connect to MongoDB` | Start MongoDB (section 6). On Windows use `127.0.0.1`, not `localhost`, in `MONGODB_URI` |
| `JWT_SECRET is required` | Set it in `backend/.env` (step 3) |
| `Port 5000 is already in use` | Close the other program or change `PORT` (and the proxy in `frontend/vite.config.js`) |
| Port 5173 in use | Close the other Vite window |
| Blockchain "offline" / "Contract not deployed" | Run `npm run chain` in its own terminal, then `npm run chain:deploy` |
| Digital IDs show NOT ON BLOCKCHAIN after restarting the chain | `npm run chain:deploy` then `npm run chain:sync` |
| "Location permission denied" | Click the padlock icon in the address bar → allow Location → reload. Use https or localhost |
| Location very inaccurate on a laptop | Normal without GPS; use a phone over HTTPS for real GPS |
| Map tiles do not load | Check your internet connection |
| Nearby help only shows records marked DEMO | The public OpenStreetMap servers are busy; try again later (results are cached), or set your own `OVERPASS_URLS` |
| Reset email never arrives | Configure `SMTP_*`; in development the link is printed in the backend terminal |
| Operator map is empty | No tourist is sharing a location right now |
| `npm test` fails at the blockchain step | Run `npm run chain:compile`; make sure port 8546 is free |
| Logged out unexpectedly | Your session expired (8 h), your password was changed, or the account was suspended |

---

## 19. Limitations and future work

- Email and SMS need provider credentials (SMTP / Twilio).
- The local Hardhat blockchain is for development only (in memory). Production needs a persistent network and a securely stored key.
- Public OpenStreetMap services (routing, addresses, places) have usage limits and no guarantee; self-host them for heavy use.
- Browser location accuracy depends on the device.
- The AI risk model only learns from incidents recorded in this system and is experimental.
- Not yet implemented: two-factor login for operators, weather data, shared infrastructure for running several backend servers (Redis).

See **[docs/STATUS.md](docs/STATUS.md)** for the full checklist.

---

## 20. Glossary

| Term | Meaning |
|---|---|
| Geo-fence / zone | An area drawn on the map (polygon) with a risk level |
| GeoJSON | Standard format for map shapes; uses `[longitude, latitude]` |
| Turf.js | JavaScript library for geographic calculations |
| JWT | JSON Web Token: proves who you are after login |
| bcrypt | Slow, salted password hashing |
| SHA-256 | Cryptographic fingerprint: any change gives a completely different hash |
| Salt | Random value mixed into a hash so it cannot be guessed |
| Smart contract | Program stored on a blockchain; here it stores hashes |
| Hardhat | Tool that runs a local Ethereum blockchain for development |
| Socket.IO | Library for live two-way communication between browser and server |
| OSRM | Open Source Routing Machine: computes routes from OpenStreetMap data |
| Nominatim / Overpass | OpenStreetMap services for addresses / searching places (police, hospitals) |
| Operator | Control-room user (role `admin` in the code) |

---

*Map data © OpenStreetMap contributors (ODbL). Academic project.*
