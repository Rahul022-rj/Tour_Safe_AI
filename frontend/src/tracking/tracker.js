// Browser location tracker, independent of React so it can be unit tested with a fake geolocation object.
// Uses navigator.geolocation.watchPosition(). The browser decides how it locates the device (GPS, Wi-Fi,
// mobile network or IP), so accuracy varies; it is always shown to the user and sent to the server.
export const GEO_OPTIONS = { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 };
export const SEND_EVERY_MS = 5000;

export const STATE_TEXT = {
  idle: 'Location sharing is off.',
  requesting: 'Waiting for your location… Your browser may ask for permission.',
  active: 'Sharing your live location with the control room.',
  denied: 'Location permission was denied. Allow location for this site in your browser settings (padlock icon in the address bar), then try again.',
  unavailable: 'Your device could not determine its location (no GPS / Wi-Fi location). Move to an open area or check that location services are on.',
  timeout: 'Getting your location is taking too long. Still trying…',
  insecure: 'Location only works on a secure (HTTPS) connection or on localhost. Ask the administrator to enable HTTPS.',
  unsupported: 'This browser does not support location services.',
};

export function createTracker({ geolocation, send, onChange, isSecure = true, throttleMs = SEND_EVERY_MS, now = () => Date.now() }) {
  let watchId = null;
  let inFlight = false;
  let state = { status: 'idle', position: null, accuracy: null, fixAt: null, sentAt: null, sendError: '', zone: null };

  const set = (patch) => {
    state = { ...state, ...patch };
    onChange?.(state);
  };

  async function maybeSend(coords) {
    if (inFlight || (state.sentAt && now() - state.sentAt < throttleMs)) return; // throttle + no overlapping requests
    inFlight = true;
    try {
      const body = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
      if (Number.isFinite(coords.speed) && coords.speed >= 0) body.speed = coords.speed;
      if (Number.isFinite(coords.heading) && coords.heading >= 0) body.heading = coords.heading;
      const result = await send(body);
      set({ sentAt: now(), sendError: '', zone: result ? { id: result.zoneId, type: result.zoneType, name: result.zoneName, confidence: result.zoneConfidence } : state.zone });
    } catch (err) {
      if (err?.status === 429) set({ sentAt: now() }); // server throttle: wait for the next window
      else set({ sendError: err?.message || 'Could not send your location' });
    } finally {
      inFlight = false;
    }
  }

  function onPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    set({ status: 'active', position: [latitude, longitude], accuracy, fixAt: pos.timestamp || now() });
    maybeSend(pos.coords);
  }

  function onError(err) {
    if (err.code === 1) {
      stop();
      set({ status: 'denied' });
    } else if (err.code === 2) set({ status: 'unavailable' });
    else if (err.code === 3) set({ status: state.position ? 'active' : 'timeout' });
    else set({ status: 'unavailable', sendError: err.message });
  }

  function start() {
    if (watchId !== null) return true; // already running: never start a second watch
    if (!isSecure) {
      set({ status: 'insecure' });
      return false;
    }
    if (!geolocation) {
      set({ status: 'unsupported' });
      return false;
    }
    set({ status: 'requesting', sendError: '' });
    watchId = geolocation.watchPosition(onPosition, onError, GEO_OPTIONS);
    return true;
  }

  function stop() {
    if (watchId !== null) geolocation.clearWatch(watchId);
    watchId = null;
    if (state.status !== 'denied') set({ status: 'idle' });
  }

  return { start, stop, getState: () => state, isRunning: () => watchId !== null };
}
