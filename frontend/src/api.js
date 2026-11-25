// Fetch wrapper used by every page: sends JSON, attaches the JWT, and turns errors into readable messages.
// The token is kept in localStorage so the Socket.IO connection can send it too (see SECURITY.md for the
// trade-off). A 401 from any request means the session ended: the app logs out and asks the user to log in.
const TOKEN_KEY = 'token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

export class ApiError extends Error {
  constructor(message, { status, code, errors } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors || {}; // field -> message, for forms
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(navigator.onLine === false ? 'You are offline. Check your internet connection.' : 'Cannot reach the server. Is the backend running?', { status: 0, code: 'NETWORK' });
  }

  const data = await res.json().catch(() => ({})); // empty body if a proxy answered
  if (!res.ok) {
    if (res.status === 401 && token && !path.startsWith('/auth/login')) {
      window.dispatchEvent(new CustomEvent('auth:expired', { detail: data.message }));
    }
    throw new ApiError(data.message || `Request failed (${res.status})`, { status: res.status, code: data.code, errors: data.errors });
  }
  return data;
}

// Downloads a file from an authenticated endpoint (e.g. CSV export)
export async function download(path, fallbackName) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.message || `Download failed (${res.status})`, { status: res.status });
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallbackName;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Builds "?a=1&b=2" from an object, skipping empty values
export const qs = (params) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
