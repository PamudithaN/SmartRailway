import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The browser calls /api on the same origin and Vite forwards it to the backend,
// so phones on the LAN or through a tunnel never need to reach localhost:5000 directly.
const proxy = {
  '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:5000', changeOrigin: true },
};

export default defineConfig({
  plugins: [
    react(),
    // Service worker is registered from React (components/UpdatePrompt.jsx) so updates can be prompted.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // public/ is already precached by workbox.globPatterns; don't list the icons twice.
      includeManifestIcons: false,
      manifest: {
        name: 'SmartRail Sri Lanka - Digital Ticketing',
        short_name: 'SmartRail',
        description: 'Smart-card train ticketing for Sri Lanka Railways: Balance, Top-ups and live train tracking.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#0F172A',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // The 12 MB hero video plays online only; never precache it.
        globIgnores: ['**/*.mp4'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // API responses are never cached here; offline data comes from lib/offlineCache.js.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    proxy,
  },
  preview: { host: true, proxy },
});
