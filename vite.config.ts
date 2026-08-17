import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function loopbackOnlyOnboarding(): Plugin {
  return {
    name: 'connected-enterprise-loopback-onboarding',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/onboarding')) {
          next()
          return
        }
        const address = String(req.socket.remoteAddress ?? '').toLowerCase()
        const loopback = address === '::1' || address === '127.0.0.1' || address.startsWith('::ffff:127.')
        if (loopback) {
          next()
          return
        }
        res.statusCode = 403
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: { code: 'LOCAL_SIMULATOR_ONLY', message: 'Onboarding development routes are available only on this workstation.' } }))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [loopbackOnlyOnboarding(), react()],
  build: {
    rollupOptions: {
      output: {
        // Peel the heavy, rarely-changing libraries into their own long-cached
        // chunks so (a) they parse/download in parallel with app code, (b) they
        // survive app deploys in the browser cache, and (c) pages that don't use
        // charts never pay for recharts + d3. Route pages are split separately
        // via React.lazy in App.tsx.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory') || id.includes('topojson')) return 'charts';
          if (id.includes('react-router') || id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react-vendor';
        },
      },
    },
  },
  server: {
    // Bind to 0.0.0.0 so any machine on the same network can hit
    //   http://<this-machine's-LAN-ip>:5174/
    // (override with `npm run dev -- --host false` if you ever want loopback only.)
    host: true,
    port: 5174,
    strictPort: true,
    // The operational twin now emits live telemetry to its parent. Keep both
    // the app and its same-origin iframe out of untrusted framing contexts in
    // development; production applies the same policy in Express.
    headers: {
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
    proxy: {
      // Forward /api/** to the agent server (see server/index.ts).
      // Important for SSE: configure: ... lets us tweak the proxy if needed.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
        ws: false,
      },
    },
  },
})
