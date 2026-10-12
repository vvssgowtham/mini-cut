import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// Cross-origin isolation is required for SharedArrayBuffer (multi-threaded ffmpeg.wasm).
// Production hosting must send the same two headers.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Dev keeps the plain module graph: a service worker caching unbundled modules makes every
      // edit look like it did not take.
      devOptions: { enabled: false },
      workbox: {
        // The editor shell only. Media never goes in here — it already lives in OPFS, and a 2 GB
        // file in the Cache API would be a second copy against the same quota.
        globPatterns: ['**/*.{js,css,html,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Caveat worth knowing: a navigation served from the cache carries the headers that were on
        // the response when it was precached. If the host ever stops sending COOP/COEP, offline
        // loads can stay cross-origin isolated while online ones do not, or the reverse — so
        // export may behave differently offline. Verify both after any hosting change.
      },
      manifest: {
        name: 'Mini Cut',
        short_name: 'Mini Cut',
        description: 'Cut video in the browser.',
        theme_color: '#0e1113',
        background_color: '#0e1113',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
  server: { headers: isolationHeaders, proxy: { '/api': 'http://localhost:3001' } },
  preview: { headers: isolationHeaders },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'] },
})
