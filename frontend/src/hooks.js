// Data hooks backed by the REST API and kept live with Socket.IO events.
// After a socket reconnect they reload from the API, so events missed while offline are not lost.
import { useCallback, useEffect, useState } from 'react';
import { api, qs } from './api';
import { useSocketEvent, useSocketReconnect } from './SocketContext';

// Geo-fence zones; reloads whenever an operator changes one (socket event "zones:changed")
export function useZones() {
  const [zones, setZones] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    return api('/zones')
      .then((data) => {
        setZones(data.zones);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useSocketEvent('zones:changed', reload);
  useSocketReconnect(reload);
  return { zones, reload, error, loading };
}

// Insert or replace incidents by id, keeping whichever copy is newer; newest incident first
export function mergeIncidents(current, incoming) {
  const byId = new Map(current.map((i) => [i._id, i]));
  for (const inc of incoming) {
    const old = byId.get(inc._id);
    if (!old || new Date(inc.updatedAt) >= new Date(old.updatedAt)) byId.set(inc._id, inc);
  }
  return [...byId.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Incidents (operator: all matching the filter, tourist: own) kept live with the "incident" socket event
export function useIncidents(params = {}) {
  const [incidents, setIncidents] = useState([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(params);

  const reload = useCallback(() => {
    setLoading(true);
    return api(`/incidents${qs({ limit: 200, ...JSON.parse(key) })}`)
      .then((data) => {
        setIncidents(data.incidents);
        setTotal(data.total);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [key]);

  useEffect(() => {
    reload();
  }, [reload]);
  useSocketEvent('incident', (incident) => setIncidents((prev) => mergeIncidents(prev, [incident])));
  // Blockchain proof status changes (pending -> confirmed/failed) without changing the incident itself
  useSocketEvent('incident:chain', (c) => setIncidents((prev) => prev.map((i) => (i._id === c._id ? { ...i, ...c } : i))));
  useSocketReconnect(reload);
  return { incidents, total, error, loading, reload };
}

// Ticks every `ms` so "x seconds ago" texts and stale markers stay correct
export function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// Browser online/offline state
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
