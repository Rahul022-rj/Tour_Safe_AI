import { describe, expect, it, vi } from 'vitest';
import { createTracker, GEO_OPTIONS } from '../tracking/tracker';

function fakeGeo() {
  const g = { watches: 0, cleared: 0, success: null, error: null, options: null };
  g.watchPosition = vi.fn((ok, err, options) => {
    g.watches++;
    g.success = ok;
    g.error = err;
    g.options = options;
    return 42;
  });
  g.clearWatch = vi.fn(() => g.cleared++);
  return g;
}
const pos = (lat, lng, accuracy = 10, timestamp = Date.now()) => ({ coords: { latitude: lat, longitude: lng, accuracy, speed: null, heading: null }, timestamp });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('location tracker', () => {
  it('uses the required watchPosition options and never starts two watches', () => {
    const geo = fakeGeo();
    const t = createTracker({ geolocation: geo, send: vi.fn() });
    t.start();
    t.start();
    expect(geo.watches).toBe(1);
    expect(geo.options).toEqual(GEO_OPTIONS);
    expect(GEO_OPTIONS).toEqual({ enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  });

  it('sends real coordinates with accuracy and throttles to one request per 5 s', async () => {
    const geo = fakeGeo();
    let now = 1_000_000;
    const send = vi.fn(async () => ({ zoneType: 'yellow', zoneId: 'z', zoneName: 'Market', zoneConfidence: 'high' }));
    const states = [];
    const t = createTracker({ geolocation: geo, send, onChange: (s) => states.push(s), now: () => now });
    t.start();
    geo.success(pos(17.36, 78.47, 12));
    await flush();
    expect(send).toHaveBeenCalledWith({ lat: 17.36, lng: 78.47, accuracy: 12 });
    now += 2000;
    geo.success(pos(17.361, 78.47, 12));
    await flush();
    expect(send).toHaveBeenCalledTimes(1); // throttled
    now += 3500;
    geo.success(pos(17.362, 78.47, 12));
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    const last = t.getState();
    expect(last.status).toBe('active');
    expect(last.position).toEqual([17.362, 78.47]); // Leaflet order [lat, lng]
    expect(last.zone.type).toBe('yellow');
  });

  it('handles permission denied by stopping the watch', () => {
    const geo = fakeGeo();
    const t = createTracker({ geolocation: geo, send: vi.fn() });
    t.start();
    geo.error({ code: 1, message: 'denied' });
    expect(t.getState().status).toBe('denied');
    expect(geo.cleared).toBe(1);
    expect(t.isRunning()).toBe(false);
  });

  it('reports unavailable and timeout without stopping', () => {
    const geo = fakeGeo();
    const t = createTracker({ geolocation: geo, send: vi.fn() });
    t.start();
    geo.error({ code: 3 });
    expect(t.getState().status).toBe('timeout');
    geo.error({ code: 2 });
    expect(t.getState().status).toBe('unavailable');
    expect(t.isRunning()).toBe(true);
  });

  it('refuses insecure contexts and missing geolocation', () => {
    expect(createTracker({ geolocation: fakeGeo(), send: vi.fn(), isSecure: false }).start()).toBe(false);
    const t = createTracker({ geolocation: undefined, send: vi.fn() });
    t.start();
    expect(t.getState().status).toBe('unsupported');
  });

  it('shows send errors but keeps tracking; server 429 is silent', async () => {
    const geo = fakeGeo();
    let now = 0;
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Server down'), { status: 503 })).mockRejectedValueOnce(Object.assign(new Error('slow down'), { status: 429 }));
    const t = createTracker({ geolocation: geo, send, now: () => now });
    t.start();
    geo.success(pos(1, 2));
    await flush();
    expect(t.getState().sendError).toBe('Server down');
    now += 6000;
    geo.success(pos(1, 2));
    await flush();
    expect(t.getState().sendError).toBe('Server down'); // unchanged by the 429
    expect(t.isRunning()).toBe(true);
  });

  it('stop clears the watch', () => {
    const geo = fakeGeo();
    const t = createTracker({ geolocation: geo, send: vi.fn() });
    t.start();
    t.stop();
    expect(geo.clearWatch).toHaveBeenCalledWith(42);
    expect(t.getState().status).toBe('idle');
  });
});
