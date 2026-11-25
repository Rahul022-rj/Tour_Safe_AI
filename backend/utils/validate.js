// Shared input checks. All functions are pure so they can be unit tested and reused by routes.

// True only for real numbers inside the valid latitude/longitude range (strings like "17.3" are rejected)
function isValidLatLng(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// E.164-style: optional +, 7 to 15 digits; spaces, dashes and brackets are allowed and stripped
const PHONE_RE = /^\+?[0-9]{7,15}$/;

const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim());
const normalizePhone = (v) => (typeof v === 'string' ? v.replace(/[\s\-().]/g, '') : '');
const isPhone = (v) => PHONE_RE.test(normalizePhone(v));

// Strong password: 8-128 chars with upper case, lower case, a digit and a symbol
function passwordProblems(pw) {
  if (typeof pw !== 'string') return ['Password is required'];
  const problems = [];
  if (pw.length < 8) problems.push('at least 8 characters');
  if (pw.length > 128) problems.push('at most 128 characters');
  if (!/[a-z]/.test(pw)) problems.push('a lower-case letter');
  if (!/[A-Z]/.test(pw)) problems.push('an upper-case letter');
  if (!/[0-9]/.test(pw)) problems.push('a digit');
  if (!/[^A-Za-z0-9]/.test(pw)) problems.push('a symbol');
  return problems;
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isObjectId = (v) => typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v);

// Validates the tourist registration body. Returns { errors: {field: message}, value }.
function validateRegistration(body = {}) {
  const errors = {};
  const value = {
    name: str(body.name, 100),
    email: str(body.email, 254).toLowerCase(),
    password: body.password,
    phone: normalizePhone(body.phone),
    nationality: str(body.nationality, 60),
    govtIdType: str(body.govtIdType, 30) || 'passport',
    govtId: str(body.govtId, 40),
    tripStart: body.tripStart,
    tripEnd: body.tripEnd,
    emergencyContact: {
      name: str(body.emergencyContact?.name, 100),
      phone: normalizePhone(body.emergencyContact?.phone),
      email: str(body.emergencyContact?.email, 254).toLowerCase(),
      relation: str(body.emergencyContact?.relation, 40),
    },
  };

  if (value.name.length < 2) errors.name = 'Full name is required';
  if (!isEmail(value.email)) errors.email = 'Enter a valid email address';
  const pw = passwordProblems(value.password);
  if (pw.length) errors.password = `Password needs ${pw.join(', ')}`;
  if (body.confirmPassword !== undefined && body.confirmPassword !== body.password) errors.confirmPassword = 'Passwords do not match';
  if (!isPhone(value.phone)) errors.phone = 'Enter a valid phone number (7-15 digits, optional +country code)';
  if (!value.nationality) errors.nationality = 'Nationality is required';
  if (!['passport', 'aadhaar', 'national_id', 'driving_licence', 'other'].includes(value.govtIdType)) errors.govtIdType = 'Unknown ID type';
  if (!/^[A-Za-z0-9\- ]{4,40}$/.test(value.govtId)) errors.govtId = 'Government ID must be 4-40 letters, digits or dashes';

  const start = new Date(value.tripStart);
  const end = new Date(value.tripEnd);
  if (!value.tripStart || Number.isNaN(start.getTime())) errors.tripStart = 'Trip start date is required';
  if (!value.tripEnd || Number.isNaN(end.getTime())) errors.tripEnd = 'Trip end date is required';
  if (!errors.tripStart && !errors.tripEnd) {
    if (end <= start) errors.tripEnd = 'Trip end must be after trip start';
    if (end < new Date()) errors.tripEnd = 'Trip end cannot be in the past';
    if (end - start > 366 * 24 * 3600 * 1000) errors.tripEnd = 'Trips longer than one year are not supported';
  }
  value.tripStart = start;
  value.tripEnd = end;

  if (value.emergencyContact.name.length < 2) errors['emergencyContact.name'] = 'Emergency contact name is required';
  if (!isPhone(value.emergencyContact.phone)) errors['emergencyContact.phone'] = 'Enter a valid emergency contact number';
  if (value.emergencyContact.email && !isEmail(value.emergencyContact.email)) errors['emergencyContact.email'] = 'Enter a valid email';
  if (!value.emergencyContact.email) delete value.emergencyContact.email;

  return { errors, value };
}

// Checks a GeoJSON Polygon: closed rings, numeric [lng, lat] positions, at least 3 distinct points,
// no self-intersection (checked with Turf by the caller), sensible size.
function polygonProblems(geometry) {
  if (!geometry || geometry.type !== 'Polygon' || !Array.isArray(geometry.coordinates)) return 'geometry must be a GeoJSON Polygon';
  if (geometry.coordinates.length < 1 || geometry.coordinates.length > 20) return 'Polygon must have 1-20 rings';
  for (const ring of geometry.coordinates) {
    if (!Array.isArray(ring) || ring.length < 4) return 'Each ring needs at least 4 positions (a triangle plus the closing point)';
    if (ring.length > 2000) return 'Polygon has too many points (max 2000)';
    for (const p of ring) {
      if (!Array.isArray(p) || p.length < 2 || !isValidLatLng(p[1], p[0])) return 'Every position must be [longitude, latitude] within range';
    }
    const [f, l] = [ring[0], ring[ring.length - 1]];
    if (f[0] !== l[0] || f[1] !== l[1]) return 'Polygon ring must be closed (first and last positions equal)';
    const distinct = new Set(ring.map((p) => `${p[0]},${p[1]}`));
    if (distinct.size < 3) return 'Polygon needs at least 3 distinct points';
  }
  return null;
}

module.exports = {
  isValidLatLng,
  isEmail,
  isPhone,
  normalizePhone,
  passwordProblems,
  validateRegistration,
  polygonProblems,
  isObjectId,
  str,
};
