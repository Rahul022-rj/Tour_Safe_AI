// External geographic services, all based on OpenStreetMap data:
//  - Nearby police stations / hospitals: Overpass API (results cached in MongoDB, labelled "openstreetmap")
//  - Routing: OSRM (routing.openstreetmap.de by default; profiles foot / car / bike)
//  - Geocoding: Nominatim (search + reverse), max 1 request per second as its usage policy requires
// Every response carries its data source and timestamp so the UI can show them.
const turf = require('@turf/turf');
const config = require('../config');
const Station = require('../models/Station');
const { getZones } = require('./geofence');
const { httpError } = require('../utils/http');

const ATTRIBUTION = '© OpenStreetMap contributors (ODbL)';

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  if (config.disableExternalApis) throw httpError(503, 'External map services are disabled (DISABLE_EXTERNAL_APIS=true)', { code: 'EXTERNAL_DISABLED' });
  const res = await fetch(url, {
    ...options,
    headers: { 'User-Agent': config.externalUserAgent, Accept: 'application/json', ...(options.headers || {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw httpError(502, `${new URL(url).host} returned HTTP ${res.status}`, { code: 'EXTERNAL_ERROR' });
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(502, `${new URL(url).host} returned an invalid response`, { code: 'EXTERNAL_ERROR' });
  }
}

// ---------- Small in-memory TTL cache ----------
const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = fn().catch((err) => {
    cache.delete(key);
    throw err;
  });
  cache.set(key, { promise, expires: Date.now() + ttlMs });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return promise;
}

// ---------- Nominatim (1 request / second) ----------
let nominatimChain = Promise.resolve();
function nominatim(path) {
  const run = nominatimChain.then(async () => {
    const data = await fetchJson(`${config.nominatimUrl}${path}`, {}, 10000);
    await new Promise((r) => setTimeout(r, 1000));
    return data;
  });
  nominatimChain = run.catch(() => {});
  return run;
}

async function geocode(q) {
  const query = String(q).trim().slice(0, 200);
  if (query.length < 3) throw httpError(400, 'Search text must be at least 3 characters');
  return cached(`geo:${query.toLowerCase()}`, 24 * 3600e3, async () => {
    const rows = await nominatim(`/search?format=jsonv2&limit=6&q=${encodeURIComponent(query)}`);
    return rows.map((r) => ({ name: r.display_name, lat: Number(r.lat), lng: Number(r.lon), type: r.type }));
  });
}

async function reverseGeocode(lat, lng) {
  const key = `rev:${lat.toFixed(4)},${lng.toFixed(4)}`;
  return cached(key, 24 * 3600e3, async () => {
    const r = await nominatim(`/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`);
    return r.display_name || null;
  });
}

// ---------- Places (Overpass) ----------
function overpassQuery(types, lat, lng, radius) {
  return `[out:json][timeout:15];nwr["amenity"~"^(${types.join('|')})$"](around:${radius},${lat},${lng});out center tags 80;`;
}

function fromOverpass(el, type) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const t = el.tags || {};
  const kind = type || t.amenity;
  if (!['police', 'hospital'].includes(kind)) return null;
  const address = [t['addr:housenumber'], t['addr:street'], t['addr:suburb'], t['addr:city']].filter(Boolean).join(', ');
  return {
    name: t.name || t['name:en'] || (kind === 'police' ? 'Police (unnamed)' : 'Hospital (unnamed)'),
    type: kind,
    phone: t.phone || t['contact:phone'] || t['emergency:phone'] || undefined,
    address: address || undefined,
    location: { type: 'Point', coordinates: [lng, lat] },
    source: 'openstreetmap',
    sourceId: `${el.type}/${el.id}`,
    verified: false,
    fetchedAt: new Date(),
  };
}

// Races every configured Overpass mirror (public servers are often overloaded) and caches the results
// in the stations collection. One combined query covers police and hospitals.
async function refreshFromOverpass(types, lat, lng, radius) {
  if (!config.overpassUrls.length) throw httpError(503, 'No Overpass server configured');
  const body = new URLSearchParams({ data: overpassQuery(types, lat, lng, radius) });
  const attempts = config.overpassUrls.map((url) =>
    fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 12000).then((data) => ({ data, url }))
  );
  let winner;
  try {
    winner = await Promise.any(attempts);
  } catch (agg) {
    const reasons = [...new Set((agg.errors || []).map((e) => e.message))].join('; ');
    throw httpError(503, `all OpenStreetMap Overpass servers failed (${reasons})`, { code: 'EXTERNAL_ERROR' });
  }
  const docs = (winner.data.elements || []).map((el) => fromOverpass(el)).filter(Boolean);
  if (docs.length) {
    await Station.bulkWrite(docs.map((d) => ({ updateOne: { filter: { source: 'openstreetmap', sourceId: d.sourceId }, update: { $set: d }, upsert: true } })));
  }
  return { fetched: docs.length, provider: new URL(winner.url).host };
}

// Remembers recent failures so an overloaded provider does not make every request wait again
const recentFailures = new Map();
const FAILURE_TTL_MS = 2 * 60e3;

const withDistance = (lat, lng) => (s) => {
  const [slng, slat] = s.location.coordinates;
  const meters = Math.round(turf.distance([lng, lat], [slng, slat], { units: 'meters' }));
  return {
    id: String(s._id),
    name: s.name,
    type: s.type,
    phone: s.phone || null,
    address: s.address || null,
    lat: slat,
    lng: slng,
    distanceM: meters,
    source: s.source,
    verified: Boolean(s.verified),
    fetchedAt: s.fetchedAt || null,
    directionsUrl: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${lat}%2C${lng}%3B${slat}%2C${slng}`,
  };
};

// Nearby facilities. Live OpenStreetMap data when reachable; otherwise previously cached OSM data and demo records,
// with a note explaining exactly what the user is looking at.
async function nearbyPlaces({ lat, lng, type, radius = 5000, limit = 15 }) {
  const types = type ? [type] : ['police', 'hospital'];
  const notes = [];
  let live = false;
  const key = `places:${types.join(',')}:${lat.toFixed(2)},${lng.toFixed(2)}:${radius}`;
  const failed = recentFailures.get(key);
  if (failed && failed.until > Date.now()) {
    notes.push(`Live OpenStreetMap lookup unavailable (${failed.message}); showing cached and demo records. Retrying in a few minutes.`);
  } else {
    try {
      await cached(key, 6 * 3600e3, () => refreshFromOverpass(types, lat, lng, radius));
      live = true;
      recentFailures.delete(key);
    } catch (err) {
      recentFailures.set(key, { until: Date.now() + FAILURE_TTL_MS, message: err.message });
      if (recentFailures.size > 200) recentFailures.delete(recentFailures.keys().next().value);
      notes.push(`Live OpenStreetMap lookup failed (${err.message}); showing cached and demo records.`);
    }
  }
  const docs = await Station.find({
    type: { $in: types },
    location: { $nearSphere: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radius } },
  })
    .limit(limit * 3)
    .lean();
  // Prefer real OSM data; only show demo records if there is no OSM record of that type nearby
  const osmTypes = new Set(docs.filter((d) => d.source === 'openstreetmap').map((d) => d.type));
  const places = docs.filter((d) => d.source === 'openstreetmap' || !osmTypes.has(d.type)).slice(0, limit).map(withDistance(lat, lng));
  if (places.some((p) => p.source === 'demo-seed')) notes.push('Records marked DEMO are sample data created by the seed script, not verified emergency facilities.');
  notes.push('OpenStreetMap data is community-maintained and not officially verified. In an emergency call 112 (India) or the local emergency number.');
  return { places, live, attribution: ATTRIBUTION, notes, generatedAt: new Date() };
}

// ---------- Routing ----------
const PROFILES = { foot: 'routed-foot', car: 'routed-car', bike: 'routed-bike' };

// Pure: which zones does a route (GeoJSON LineString) pass through?
function routeZoneHits(line, zones) {
  const feature = turf.lineString(line.coordinates);
  const hits = [];
  for (const z of zones) {
    if (z.type === 'green') continue;
    if (turf.booleanIntersects(feature, turf.polygon(z.geometry.coordinates))) {
      hits.push({ id: String(z._id), name: z.name, type: z.type, source: z.source || 'Operator-defined', reviewedAt: z.reviewedAt || z.updatedAt });
    }
  }
  return hits;
}

// Pure: safest first (no red, then fewest yellow), then fastest
function rankRoutes(routes) {
  return [...routes].sort((a, b) => {
    const ra = a.zones.filter((z) => z.type === 'red').length;
    const rb = b.zones.filter((z) => z.type === 'red').length;
    if (ra !== rb) return ra - rb;
    const ya = a.zones.filter((z) => z.type === 'yellow').length;
    const yb = b.zones.filter((z) => z.type === 'yellow').length;
    if (ya !== yb) return ya - yb;
    return a.durationS - b.durationS;
  });
}

async function safeRoute({ from, to, mode = 'foot' }) {
  const profile = PROFILES[mode];
  if (!profile) throw httpError(400, 'mode must be foot, car or bike');
  const straightKm = turf.distance([from.lng, from.lat], [to.lng, to.lat], { units: 'kilometers' });
  if (straightKm > 300) throw httpError(400, 'Destination is too far away (over 300 km)');

  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const url = `${config.osrmUrl}/${profile}/route/v1/driving/${coords}?alternatives=3&overview=full&geometries=geojson&steps=false`;
  const data = await cached(`route:${mode}:${coords}`, 10 * 60e3, () => fetchJson(url, {}, 20000));
  if (data.code !== 'Ok' || !data.routes?.length) throw httpError(404, `No route found (${data.message || data.code})`, { code: 'NO_ROUTE' });

  const zones = await getZones();
  const routes = rankRoutes(
    data.routes.map((r, i) => {
      const hits = routeZoneHits(r.geometry, zones);
      return {
        index: i,
        distanceM: Math.round(r.distance),
        durationS: Math.round(r.duration),
        geometry: r.geometry, // GeoJSON LineString, [lng, lat]
        zones: hits,
        risk: hits.some((z) => z.type === 'red') ? 'restricted' : hits.length ? 'caution' : 'clear',
      };
    })
  );

  const warnings = [];
  if (routes[0].risk === 'restricted') warnings.push('Every route the routing service returned passes through a restricted zone. Consider another destination or ask the help desk.');
  else if (routes.some((r) => r.risk === 'restricted')) warnings.push('Some alternatives cross restricted zones; they are listed last.');
  if (routes[0].risk === 'caution') warnings.push('The suggested route passes through a caution zone. Stay alert.');

  const latestReview = zones.reduce((max, z) => Math.max(max, new Date(z.reviewedAt || z.updatedAt || 0).getTime()), 0);
  return {
    routes,
    recommendedIndex: routes[0].index,
    warnings,
    disclaimer: 'Routes come from OpenStreetMap data and are checked against the safety zones known to TourSafe. No route is guaranteed safe; follow local guidance.',
    routingSource: `OSRM (${new URL(config.osrmUrl).host}) - ${ATTRIBUTION}`,
    riskSource: { description: 'TourSafe operator-defined safety zones', zoneCount: zones.length, lastReviewedAt: latestReview ? new Date(latestReview) : null },
    note: 'The routing engine cannot be told to avoid zones directly, so alternatives are ranked by the zones they cross.',
    generatedAt: new Date(),
  };
}

module.exports = { geocode, reverseGeocode, nearbyPlaces, safeRoute, routeZoneHits, rankRoutes, fromOverpass };
