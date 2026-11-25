// /api/geo -> nearby police/hospitals, safe routes, geocoding (all logged-in users)
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { externalLimiter } = require('../middleware/security');
const geo = require('../services/geo');
const { isValidLatLng } = require('../utils/validate');
const { httpError } = require('../utils/http');

const router = express.Router();
router.use(requireAuth);

const num = (v) => (v === undefined || v === '' ? NaN : Number(v));
// latLngFrom(q) reads lat/lng; latLngFrom(q, 'from') reads fromLat/fromLng
function latLngFrom(query, prefix = '') {
  const key = (k) => (prefix ? `${prefix}${k[0].toUpperCase()}${k.slice(1)}` : k);
  const lat = num(query[key('lat')]);
  const lng = num(query[key('lng')]);
  if (!isValidLatLng(lat, lng)) throw httpError(400, `${key('lat')} and ${key('lng')} must be valid coordinates`);
  return { lat, lng };
}

// GET /api/geo/places?lat=&lng=&type=police|hospital&radius=5000
router.get('/places', externalLimiter, async (req, res) => {
  const { lat, lng } = latLngFrom(req.query);
  const type = req.query.type ? String(req.query.type) : undefined;
  if (type && !['police', 'hospital'].includes(type)) throw httpError(400, 'type must be police or hospital');
  const radius = Math.min(20000, Math.max(500, num(req.query.radius) || 5000));
  res.json(await geo.nearbyPlaces({ lat, lng, type, radius }));
});

// GET /api/geo/route?fromLat=&fromLng=&toLat=&toLng=&mode=foot|car|bike
router.get('/route', externalLimiter, async (req, res) => {
  const from = latLngFrom(req.query, 'from');
  const to = latLngFrom(req.query, 'to');
  const mode = String(req.query.mode || 'foot');
  res.json(await geo.safeRoute({ from, to, mode }));
});

// GET /api/geo/search?q=charminar
router.get('/search', externalLimiter, async (req, res) => {
  res.json({ results: await geo.geocode(String(req.query.q || '')), attribution: '© OpenStreetMap contributors (Nominatim)' });
});

// GET /api/geo/reverse?lat=&lng=
router.get('/reverse', externalLimiter, async (req, res) => {
  const { lat, lng } = latLngFrom(req.query);
  res.json({ address: await geo.reverseGeocode(lat, lng) });
});

// GET /api/geo/risk?lat=&lng= -> experimental risk indication for a place (advisory only)
router.get('/risk', async (req, res) => {
  const { lat, lng } = latLngFrom(req.query);
  res.json(await require('../services/risk').predict({ lat, lng, at: new Date() }));
});

module.exports = router;
