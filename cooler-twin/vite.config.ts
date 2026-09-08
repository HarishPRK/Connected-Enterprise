import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3002' },
      '/ws': { target: 'ws://127.0.0.1:3002', ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1200 },
  preview: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:3002' },
      '/ws': { target: 'ws://127.0.0.1:3002', ws: true },
    },
  },
})
