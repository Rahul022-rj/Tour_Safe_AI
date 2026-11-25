// Deterministic JSON serialization for hashing. The same logical record must always produce the same bytes:
//  - object keys are sorted
//  - undefined values and functions are dropped (null is kept)
//  - Dates become ISO-8601 strings in UTC
//  - Mongo ObjectIds become their 24-char hex string
//  - numbers: -0 becomes 0, non-finite numbers are rejected, otherwise the shortest round-trip form JS gives
function normalize(value) {
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error('canonical: invalid date');
    return value.toISOString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical: non-finite number');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    // ObjectId (bson) exposes toHexString; populated documents have _id
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normalize(v)));
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined || typeof v === 'function') continue;
      out[key] = normalize(v);
    }
    return out;
  }
  return undefined;
}

function canonicalStringify(value) {
  return JSON.stringify(normalize(value));
}

module.exports = { canonicalStringify, normalize };
