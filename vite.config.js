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
      includeAssets: ['arrow.png', 'apple-touch-icon.png', 'vite.svg'],
      manifest: {
        name: 'Manhunt',
        short_name: 'Manhunt',
        description: 'Real-world hide and seek game',
        start_url: '/',
        display: 'standalone',
        background_color: '#1a1a1a',
        theme_color: '#1a1a1a',
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
        // The SPA fallback must never swallow API or socket requests
        navigateFallbackDenylist: [/^\/manhunt-api/],
        runtimeCaching: [
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
    allowedHosts: [
      '.ngrok-free.app',
      '.ngrok.app',
      '.ngrok-free.dev',
      '.ngrok.io',
      '.trycloudflare.com',
    ],
  },
})
