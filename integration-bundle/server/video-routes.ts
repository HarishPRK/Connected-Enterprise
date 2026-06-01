/**
 * Video analytics routes — registers /api/video and /api/video/:id on the
 * Express app. Each :id maps to an MJPEG endpoint on a private-LAN inference
 * node; the server streams the multipart/x-mixed-replace body straight
 * through to the browser.
 *
 * Stream IDs (must match what VideoAnalytics.tsx requests):
 *   nv-nanoowl, nv-violence, nv-fall, nv-ppe, nv-table, nv-weapon, nv-parking
 *   ha-anpd, ha-intruder, ha-hairnet, ha-fire, ha-crowd, ha-drive
 *
 * Env vars consumed (in priority order):
 *   1. VIDEO_UPSTREAM_<ID_UPPER_SNAKE>  — full URL override per stream
 *   2. VIDEO_BASE_NVIDIA / VIDEO_BASE_HAILO — group base URL, suffixed by path
 *   3. Hardcoded defaults below (private LAN IPs).
 *
 * On a cloud host with a Tailscale/WireGuard mesh: set VIDEO_BASE_NVIDIA /
 * VIDEO_BASE_HAILO to the tailnet IPs of the inference nodes. No code change.
 *
 * Usage:
 *   import { registerVideoRoutes } from './video-routes.js';
 *   registerVideoRoutes(app);
 */

import type { Express } from 'express';

const VIDEO_DEFAULT_BASES = {
  nvidia: 'http://192.168.10.100:5000',
  hailo:  'http://192.168.10.160:5000',
} as const;

const VIDEO_STREAM_PATHS: Record<string, { base: keyof typeof VIDEO_DEFAULT_BASES; path: string }> = {
  'nv-nanoowl':  { base: 'nvidia', path: '/nanoowl_feed' },
  'nv-violence': { base: 'nvidia', path: '/violence_feed' },
  'nv-fall':     { base: 'nvidia', path: '/fall_feed' },
  'nv-ppe':      { base: 'nvidia', path: '/ppe_feed' },
  'nv-table':    { base: 'nvidia', path: '/table_feed' },
  'nv-weapon':   { base: 'nvidia', path: '/weapon_feed' },
  'nv-parking':  { base: 'nvidia', path: '/parking_feed' },
  'ha-anpd':     { base: 'hailo',  path: '/anpd_feed' },
  'ha-intruder': { base: 'hailo',  path: '/intruder_feed' },
  'ha-hairnet':  { base: 'hailo',  path: '/hairnetmonitor_feed' },
  'ha-fire':     { base: 'hailo',  path: '/firedetection_feed' },
  'ha-crowd':    { base: 'hailo',  path: '/crowd_feed' },
  'ha-drive':    { base: 'hailo',  path: '/drive_thru_monitor_stream' },
};

function getVideoUpstream(id: string): string | null {
  const envKey = `VIDEO_UPSTREAM_${id.replace(/-/g, '_').toUpperCase()}`;
  const direct = process.env[envKey];
  if (direct) return direct;
  const def = VIDEO_STREAM_PATHS[id];
  if (!def) return null;
  const baseKey = `VIDEO_BASE_${def.base.toUpperCase()}`;
  const base = process.env[baseKey] ?? VIDEO_DEFAULT_BASES[def.base];
  return `${base.replace(/\/+$/, '')}${def.path}`;
}

export function registerVideoRoutes(app: Express): void {
  /** List of configured streams + their resolved upstreams. Handy for debugging. */
  app.get('/api/video', (_req, res) => {
    res.json(
      Object.keys(VIDEO_STREAM_PATHS).map((id) => ({
        id,
        upstream: getVideoUpstream(id),
      })),
    );
  });

  /** MJPEG passthrough. */
  app.get('/api/video/:id', async (req, res) => {
    const upstream = getVideoUpstream(req.params.id);
    if (!upstream) {
      res.status(404).json({ error: `Unknown stream id: ${req.params.id}` });
      return;
    }

    const ctrl = new AbortController();
    const onClose = () => ctrl.abort();
    req.on('close', onClose);

    try {
      const r = await fetch(upstream, { signal: ctrl.signal });
      if (!r.ok || !r.body) {
        if (!res.headersSent) res.status(502).json({ error: `upstream ${r.status}` });
        return;
      }

      // MJPEG = multipart/x-mixed-replace. Pass content-type and boundary verbatim.
      const ct = r.headers.get('content-type');
      if (ct) res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'no-cache, no-transform, no-store');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      res.socket?.setNoDelay(true);
      res.socket?.setKeepAlive(true);

      const reader = r.body.getReader();
      while (!ctrl.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writable || res.writableEnded) break;
        res.write(value);
      }
    } catch (err) {
      if ((err as { name?: string }).name !== 'AbortError') {
        // eslint-disable-next-line no-console
        console.error(`[video-proxy:${req.params.id}] upstream error:`, err);
        if (!res.headersSent) {
          res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      req.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  });
}
