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
    rolldownOptions: {
      output: {
        // Explicit ownership prevents a chart group from recursively capturing
        // React/JSX and making every route load the chart runtime at startup.
        // Geography stays independent of Recharts; their small shared D3
        // utilities have their own chunk. Unmatched modules keep automatic
        // splitting, including the existing React.lazy route boundaries.
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              // React Router also has dynamic imports. Its Vite helper must
              // not live in the app entry and create a vendor → entry cycle.
              name: 'module-preload', priority: 110,
              test: /\0vite\/preload-helper\.js$/,
            },
            {
              name: 'react-vendor', priority: 100,
              test: /node_modules[\\/](?:react(?:-dom|-router(?:-dom)?)?|scheduler|use-sync-external-store)[\\/]/,
            },
            {
              name: 'd3-shared', priority: 40,
              test: /node_modules[\\/](?:d3-array|internmap)[\\/]/,
            },
            {
              name: 'geography', priority: 30,
              test: /node_modules[\\/](?:d3-geo|topojson(?:-client|-server)?)[\\/]/,
            },
            {
              name: 'charts', priority: 20,
              test: /node_modules[\\/](?:recharts|victory[^\\/]*|d3-[^\\/]+)[\\/]/,
            },
          ],
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
