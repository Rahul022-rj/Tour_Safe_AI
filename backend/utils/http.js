// Small helpers shared by routes and services

// Error carrying an HTTP status; the central error handler sends { message } with that status
function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, expose: true, ...extra });
}

// Hides most of an email address or phone number for logs and notification history
function mask(value) {
  if (!value) return '';
  const s = String(value);
  if (s.includes('@')) {
    const [user, domain] = s.split('@');
    return `${user.slice(0, 2)}***@${domain}`;
  }
  return s.length <= 4 ? '****' : `${s.slice(0, 3)}${'*'.repeat(Math.max(0, s.length - 7))}${s.slice(-4)}`;
}

// ?page=2&limit=20 -> { page, limit, skip } with sane bounds
function pagination(query, defaultLimit = 25, maxLimit = 200) {
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const limit = Math.min(maxLimit, Math.max(1, Math.floor(Number(query.limit) || defaultLimit)));
  return { page, limit, skip: (page - 1) * limit };
}

// Escape user text before using it inside a RegExp (search boxes)
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ?from=2026-01-01&to=2026-01-31 -> Mongo date range filter (or undefined)
function dateRange(query) {
  const range = {};
  if (query.from) {
    const d = new Date(String(query.from));
    if (!Number.isNaN(d.getTime())) range.$gte = d;
  }
  if (query.to) {
    const d = new Date(String(query.to));
    if (!Number.isNaN(d.getTime())) {
      // a plain date "2026-01-31" means "until the end of that day"
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.to))) d.setUTCHours(23, 59, 59, 999);
      range.$lte = d;
    }
  }
  return Object.keys(range).length ? range : undefined;
}

module.exports = { httpError, mask, pagination, escapeRegex, dateRange };
