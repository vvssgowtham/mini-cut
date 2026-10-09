import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Cross-origin isolation is required for SharedArrayBuffer (multi-threaded ffmpeg.wasm).
// Production hosting must send the same two headers.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
})
