import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    // MapLibre's lazy-loaded vendor chunk is large by design; the initial app chunk stays below the default limit.
    chunkSizeWarningLimit: 1000,
  },
})