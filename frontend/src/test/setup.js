import '@testing-library/jest-dom/vitest';

// Node 22+ ships its own (disabled) global localStorage which hides jsdom's; use a simple in-memory one
const memoryStorage = () => {
  let data = {};
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    clear: () => { data = {}; },
    key: (i) => Object.keys(data)[i] ?? null,
    get length() { return Object.keys(data).length; },
  };
};
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true, writable: true });
if (typeof window !== 'undefined') Object.defineProperty(window, 'localStorage', { value: globalThis.localStorage, configurable: true });

// Leaflet picks the SVG renderer only if createSVGRect exists (jsdom does not implement it)
if (typeof window !== 'undefined' && window.SVGSVGElement && !window.SVGSVGElement.prototype.createSVGRect) {
  window.SVGSVGElement.prototype.createSVGRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
}
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// socket.io-client is replaced by an inert fake: tests talk to a mocked fetch, not a server
vi.mock('socket.io-client', () => {
  const make = () => {
    const handlers = {};
    const s = {
      connected: false,
      on: (e, fn) => ((handlers[e] ||= []).push(fn), s),
      off: (e, fn) => ((handlers[e] = (handlers[e] || []).filter((h) => h !== fn)), s),
      removeAllListeners: () => s,
      disconnect: () => s,
      emit: () => s,
      io: { on: () => {} },
    };
    return s;
  };
  return { io: vi.fn(make) };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// Leaflet needs a few browser APIs jsdom lacks
if (!window.matchMedia) window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
if (!window.ResizeObserver) window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
