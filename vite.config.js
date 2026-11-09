import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Manhunt',
        short_name: 'Manhunt',
        description: 'Real-world hide and seek game',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b0d14',
        theme_color: '#0b0d14',
        orientation: 'portrait',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // Precache the bundled typefaces with the shell so text renders in
        // IBM Plex even when the app is opened with no connection
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // The SPA fallback must never swallow API or socket requests
        navigateFallbackDenylist: [/^\/manhunt-api/],
        runtimeCaching: [
          {
            // Map tiles: keep what's been seen so the play-area map still
            // draws on a weak connection (OpenStreetMap allows caching)
            urlPattern: ({ url }) => url.hostname === 'tile.openstreetmap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 600, maxAgeSeconds: 14 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Game data must always be live — never served from cache
            urlPattern: ({ url }) => url.pathname.startsWith('/manhunt-api'),
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ],
  server: {
    // Allow the dev server (`npm run dev`) to be reached through a tunnel.
    // Leading-dot entries match any subdomain of that suffix.
    // Note: single-origin (`npm run tunnel`) is the recommended way to expose
    // the app publicly, since it tunnels the frontend + API + socket together.
    allowedHosts: ['.trycloudflare.com'],
  },
})
