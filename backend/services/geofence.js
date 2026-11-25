// Geo-fencing: which zone is a point in, how certain are we, and should we raise an alert?
// findZone(), classify() and shouldAlert() are pure functions (no database), so they are easy to unit test.
// Coordinates: GeoJSON/Turf use [longitude, latitude] everywhere in this file.
const turf = require('@turf/turf');
const config = require('../config');
const Zone = require('../models/Zone');

// When zones overlap, the most dangerous one wins
const ZONE_PRIORITY = { red: 3, yellow: 2, green: 1 };
const ALERT_TYPES = ['red', 'yellow'];

// point = [lng, lat]. Returns the highest-priority zone that contains the point, or null.
function findZone(point, zones) {
  let best = null;
  for (const zone of zones) {
    if (turf.booleanPointInPolygon(point, zone.geometry)) {
      if (!best || ZONE_PRIORITY[zone.type] > ZONE_PRIORITY[best.type]) best = zone;
    }
  }
  return best;
}

// Distance in metres from a point to the nearest edge of a polygon
function distanceToBoundary(point, geometry) {
  const lines = turf.polygonToLine(turf.polygon(geometry.coordinates));
  const features = lines.type === 'FeatureCollection' ? lines.features : [lines];
  let min = Infinity;
  for (const f of features) {
    const parts = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const coords of parts) {
      min = Math.min(min, turf.pointToLineDistance(turf.point(point), turf.lineString(coords), { units: 'meters' }));
    }
  }
  return min;
}

// Zone + confidence for one reading.
//  - accuracy unknown (browser did not report it) -> treated as exact
//  - accuracy worse than GEOFENCE_MAX_ACCURACY_M -> 'uncertain' (never alerts)
//  - accuracy circle crosses the boundary of any zone the point might be in or near -> 'uncertain'
function classify(point, zones, accuracy, maxAccuracy = config.geofenceMaxAccuracyM) {
  const zone = findZone(point, zones);
  let confidence = 'high';
  if (Number.isFinite(accuracy) && accuracy > 0) {
    if (accuracy > maxAccuracy) confidence = 'uncertain';
    else {
      // Only zones whose priority could change the answer matter (the chosen zone and anything riskier nearby)
      for (const z of zones) {
        if (zone && ZONE_PRIORITY[z.type] < ZONE_PRIORITY[zone.type] && z._id !== zone._id) continue;
        if (distanceToBoundary(point, z.geometry) < accuracy) {
          confidence = 'uncertain';
          break;
        }
      }
    }
  }
  return { zone, confidence };
}

// Alert only when the tourist moves INTO a different zone that is red or yellow, with a confident reading.
// Staying inside the same zone, entering a green zone, or an uncertain reading does not alert.
function shouldAlert(previousZoneId, newZone, confidence = 'high') {
  if (confidence !== 'high') return false;
  if (!newZone || !ALERT_TYPES.includes(newZone.type)) return false;
  return String(newZone._id) !== String(previousZoneId);
}

// Full validation of an operator-drawn polygon. Returns an error message or null.
function geometryProblem(geometry) {
  try {
    const poly = turf.polygon(geometry.coordinates);
    if (turf.kinks(poly).features.length > 0) return 'Invalid zone shape: the edges must not cross each other';
    const area = turf.area(poly);
    if (area < 100) return 'Zone is too small (under 100 m²)';
    if (area > 5e9) return 'Zone is too large (over 5000 km²)';
    return null;
  } catch (err) {
    return `Invalid polygon: ${err.message}`;
  }
}

// ----- Zone cache -----
// Locations arrive every few seconds, so zones are kept in memory instead of querying MongoDB each time.
// The cache is cleared whenever an operator changes a zone, and refreshed every 30 s anyway (other instances).
const CACHE_MS = 30 * 1000;
let cachedZones = null;
let cachedAt = 0;

async function getZones() {
  if (!cachedZones || Date.now() - cachedAt > CACHE_MS) {
    cachedZones = await Zone.find().lean();
    cachedAt = Date.now();
  }
  return cachedZones;
}

function clearZoneCache() {
  cachedZones = null;
}

module.exports = { findZone, classify, shouldAlert, distanceToBoundary, geometryProblem, getZones, clearZoneCache, ZONE_PRIORITY };
