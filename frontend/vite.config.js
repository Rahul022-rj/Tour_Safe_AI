import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // fail loudly instead of silently moving to 5174
    host: true, // also reachable from a phone on the same network (use HTTPS for geolocation there)
    // Forward API and Socket.IO calls to the backend, so the browser sees one origin (no CORS problems)
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/socket.io': { target: 'http://127.0.0.1:5000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split big libraries into their own cacheable files
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          leaflet: ['leaflet', 'react-leaflet', 'leaflet-draw'],
          qr: ['html5-qrcode'],
          socket: ['socket.io-client'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    css: false,
  },
});
