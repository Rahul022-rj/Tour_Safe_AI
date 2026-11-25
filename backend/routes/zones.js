// /api/zones -> geo-fence zones. Everyone logged in can read them, only operators can change them.
const express = require('express');
const Zone = require('../models/Zone');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { clearZoneCache, getZones, classify, geometryProblem } = require('../services/geofence');
const { audit } = require('../services/audit');
const { emitToAll, emitToAdmins, emitToUser } = require('../socket');
const { polygonProblems, isObjectId, str } = require('../utils/validate');
const { httpError } = require('../utils/http');

const router = express.Router();
const TYPES = ['red', 'yellow', 'green'];

function validateGeometry(geometry) {
  const problem = polygonProblems(geometry) || geometryProblem(geometry);
  if (problem) throw httpError(400, problem, { code: 'INVALID_GEOMETRY' });
  return { type: 'Polygon', coordinates: geometry.coordinates.map((ring) => ring.map((p) => [p[0], p[1]])) };
}

// After a zone change, tourists may now be in a different zone even though they did not move.
// Their stored zone is updated (no "entry" alert: they did not cross a boundary) and dashboards are refreshed.
async function reclassifyTourists() {
  const zones = await getZones();
  const tourists = await User.find({ role: 'tourist', 'lastLocation.coordinates.1': { $exists: true } })
    .select('name lastLocation lastAccuracy lastZoneId lastZoneType lastSeenAt lastSource trackingActive')
    .lean();
  for (const t of tourists) {
    const [lng, lat] = t.lastLocation.coordinates;
    const { zone, confidence } = classify([lng, lat], zones, t.lastAccuracy ?? undefined);
    const zoneId = zone ? zone._id : null;
    const zoneType = zone ? zone.type : 'none';
    if (String(zoneId) === String(t.lastZoneId) && zoneType === t.lastZoneType) continue;
    await User.updateOne({ _id: t._id }, { lastZoneId: zoneId, lastZoneType: zoneType, lastZoneEnteredAt: new Date() });
    const update = {
      userId: String(t._id), name: t.name, lat, lng, accuracy: t.lastAccuracy ?? null, source: t.lastSource, timestamp: t.lastSeenAt,
      zoneId: zoneId ? String(zoneId) : null, zoneName: zone?.name || null, zoneType, zoneConfidence: confidence, trackingActive: t.trackingActive, reclassified: true,
    };
    emitToAdmins('location:update', update);
    emitToUser(update.userId, 'location:self', update);
  }
}

// After any change: forget the cached zones, tell every open map to reload, re-evaluate tourists
function zonesChanged() {
  clearZoneCache();
  emitToAll('zones:changed', {});
  reclassifyTourists().catch((err) => console.warn(`[zones] reclassify failed: ${err.message}`));
}

// GET /api/zones
router.get('/', requireAuth, async (req, res) => {
  const filter = TYPES.includes(req.query.type) ? { type: req.query.type } : {};
  const zones = await Zone.find(filter).sort({ type: 1, name: 1 }).lean();
  res.json({ zones });
});

// GET /api/zones/:id
router.get('/:id', requireAuth, async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid zone id');
  const zone = await Zone.findById(req.params.id).lean();
  if (!zone) return res.status(404).json({ message: 'Zone not found' });
  res.json({ zone });
});

// POST /api/zones  body: { name, type, description, source, geometry }  (geometry comes from leaflet-draw)
router.post('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { name, type, description, source, geometry } = req.body || {};
  if (!str(name, 100)) throw httpError(400, 'Zone name is required');
  if (!TYPES.includes(type)) throw httpError(400, 'type must be red, yellow or green');
  const zone = await Zone.create({
    name: str(name, 100),
    type,
    description: str(description, 500),
    source: str(source, 200) || 'Operator-defined',
    reviewedAt: new Date(),
    geometry: validateGeometry(geometry),
    createdBy: req.user.id,
    updatedBy: req.user.id,
  });
  await audit(req, 'ZONE_CREATE', { targetType: 'Zone', targetId: zone._id, details: { name: zone.name, type } });
  zonesChanged();
  res.status(201).json({ zone });
});

// PUT /api/zones/:id  body: any of { name, type, description, source, geometry }
router.put('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid zone id');
  const b = req.body || {};
  const changes = { updatedBy: req.user.id, reviewedAt: new Date() };
  if (b.name !== undefined) {
    if (!str(b.name, 100)) throw httpError(400, 'Zone name is required');
    changes.name = str(b.name, 100);
  }
  if (b.type !== undefined) {
    if (!TYPES.includes(b.type)) throw httpError(400, 'type must be red, yellow or green');
    changes.type = b.type;
  }
  if (b.description !== undefined) changes.description = str(b.description, 500);
  if (b.source !== undefined) changes.source = str(b.source, 200) || 'Operator-defined';
  if (b.geometry !== undefined) changes.geometry = validateGeometry(b.geometry);

  const zone = await Zone.findByIdAndUpdate(req.params.id, changes, { new: true, runValidators: true });
  if (!zone) return res.status(404).json({ message: 'Zone not found' });
  await audit(req, 'ZONE_UPDATE', { targetType: 'Zone', targetId: zone._id, details: { fields: Object.keys(changes).filter((k) => !['updatedBy', 'reviewedAt'].includes(k)) } });
  zonesChanged();
  res.json({ zone });
});

// DELETE /api/zones/:id
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  if (!isObjectId(req.params.id)) throw httpError(400, 'Invalid zone id');
  const zone = await Zone.findByIdAndDelete(req.params.id);
  if (!zone) return res.status(404).json({ message: 'Zone not found' });
  await audit(req, 'ZONE_DELETE', { targetType: 'Zone', targetId: zone._id, details: { name: zone.name, type: zone.type } });
  zonesChanged();
  res.json({ message: 'Zone deleted' });
});

module.exports = router;
module.exports.reclassifyTourists = reclassifyTourists;
