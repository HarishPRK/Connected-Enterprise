import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to 0.0.0.0 so any machine on the same network can hit
    //   http://<this-machine's-LAN-ip>:5174/
    // (override with `npm run dev -- --host false` if you ever want loopback only.)
    host: true,
    port: 5174,
    strictPort: true,
    proxy: {
      // Forward /api/** to the agent server (see server/index.ts).
      // Important for SSE: configure: ... lets us tweak the proxy if needed.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        ws: false,
      },
    },
  },
})
