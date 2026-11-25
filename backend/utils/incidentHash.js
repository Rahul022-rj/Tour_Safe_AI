// SHA-256 fingerprint of an incident's full state. Logged on the blockchain after every change;
// the integrity check recomputes it from MongoDB and compares it with the recorded proofs.
const crypto = require('crypto');
const { canonicalStringify } = require('./canonical');

// Works for plain and populated documents (populated refs are objects with _id)
const idOf = (value) => (value === null || value === undefined ? null : String(value?._id ?? value));
const iso = (d) => (d ? new Date(d).toISOString() : null);
// Coordinates are rounded to 7 decimals (~1 cm) so float formatting can never change the hash
const coord = (n) => Math.round(Number(n) * 1e7) / 1e7;

// The canonical representation. Version "v" lets the format change later without breaking old proofs.
// updatedAt and the chain* fields are left out: they change when we save the chain proof itself.
function canonicalIncident(incident) {
  return {
    v: 2,
    id: idOf(incident._id),
    touristId: idOf(incident.touristId),
    type: incident.type,
    message: incident.message || '',
    coordinates: (incident.location?.coordinates || []).map(coord),
    locationSource: incident.locationSource || 'live',
    status: incident.status,
    resolution: incident.resolution || null,
    assignedTo: incident.assignedTo || '',
    revision: incident.revision || 0,
    history: (incident.history || []).map((h) => ({
      status: h.status,
      by: idOf(h.by),
      note: h.note || '',
      at: iso(h.at),
    })),
    notes: (incident.notes || []).map((n) => ({ text: n.text, by: idOf(n.by), at: iso(n.at) })),
    createdAt: iso(incident.createdAt),
  };
}

function computeIncidentHash(incident) {
  return '0x' + crypto.createHash('sha256').update(canonicalStringify(canonicalIncident(incident))).digest('hex');
}

module.exports = { computeIncidentHash, canonicalIncident };
