/**
 * Wire-format check for the app-route proto pair:
 *   src/proto/appRoute.ts      (browser encoder)
 *   server/appRouteProto.ts    (server decoder)
 *
 * Run: npx tsx scripts/test-approute-proto.ts
 *
 * Asserts golden bytes for a known message (so the encoder is checked against
 * the proto3 spec, not just against our own decoder), a full round-trip, and
 * decoder tolerance of unknown trailing fields.
 */

import { encodeAppRouteCommand, encodeTunnelBinding, toHex, type AppRouteCommand } from '../src/proto/appRoute.js';
import { decodeAppRouteCommand } from '../server/appRouteProto.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  // eslint-disable-next-line no-console
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/* 1 — golden bytes, hand-computed from the proto3 spec:
 *     field 1 (application="A"): tag 0x0A, len 1, 0x41
 *     field 2 (tunnel="B"):      tag 0x12, len 1, 0x42            */
const golden = toHex(encodeTunnelBinding({ application: 'A', tunnel: 'B' }));
check('TunnelBinding golden bytes', golden === '0a 01 41 12 01 42', `got ${golden}`);

/* 2 — full command round-trip through the real server decoder */
const cmd: AppRouteCommand = {
  timestamp_ms: 1768521600123,
  source: 'prpl',
  gateway: 'prpl-gw-01',
  changes: [
    {
      client_mac: 'aa:bb:cc:00:00:04',
      client_name: 'kitchen-pos',
      current: { application: 'Netflix', tunnel: 'vti-fiber1' },
      desired: { application: 'Netflix', tunnel: 'vti-cell1' },
    },
    {
      client_mac: 'aa:bb:cc:00:00:01',
      client_name: 'front-desk',
      current: { application: 'Microsoft Teams', tunnel: 'vti-fiber2' },
      desired: { application: 'Microsoft Teams', tunnel: 'vti-fiber1' },
    },
  ],
};
const bytes = encodeAppRouteCommand(cmd);
const decoded = decodeAppRouteCommand(bytes);
check('round-trip equality', JSON.stringify(decoded) === JSON.stringify(cmd),
  `decoded ${JSON.stringify(decoded)}`);
check('payload is compact', bytes.length > 0 && bytes.length < 512, `${bytes.length} bytes`);

/* 3 — proto3 defaults: zero/empty fields are omitted on the wire but decode
 *     back to defaults */
const sparse = encodeAppRouteCommand({ timestamp_ms: 0, source: '', gateway: '', changes: [] });
check('defaults omitted on the wire', sparse.length === 0, `${sparse.length} bytes`);
const sparseBack = decodeAppRouteCommand(sparse);
check('defaults restored on decode',
  sparseBack.timestamp_ms === 0 && sparseBack.source === '' && sparseBack.changes.length === 0);

/* 4 — decoder skips unknown trailing fields (forward compatibility):
 *     field 15, varint wire type → tag 0x78, value 0x01 */
const withUnknown = new Uint8Array([...bytes, 0x78, 0x01]);
const decodedUnknown = decodeAppRouteCommand(withUnknown);
check('unknown fields skipped', JSON.stringify(decodedUnknown) === JSON.stringify(cmd));

// eslint-disable-next-line no-console
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
