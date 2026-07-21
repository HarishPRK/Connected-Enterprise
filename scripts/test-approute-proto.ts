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

import { encodeAppRouteCommand, encodeTunnelBinding, encodeClientFreeze, toHex, type AppRouteCommand } from '../src/proto/appRoute.js';
import { decodeAppRouteCommand } from '../server/appRouteProto.js';

let failures = 0;

/** Canonical JSON — sorts object keys recursively so equality checks compare
 *  DATA, not field order (the decoder emits fields in wire order, which need
 *  not match the order of the source literal). */
const canon = (v: unknown): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : val);

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

/* 2 — full command round-trip through the real server decoder, covering the
 *     v2 fields: advisor origin/reason/gain (double) + a freeze toggle.
 *     Field values that are proto3 defaults ('' / 0 / false) are omitted on
 *     the wire and restored on decode, so JSON equality still holds. */
const cmd: AppRouteCommand = {
  timestamp_ms: 1768521600123,
  source: 'prpl',
  gateway: 'prpl-gw-01',
  type: 'user_initiated',
  changes: [
    {
      client_mac: 'aa:bb:cc:00:00:04',
      client_name: 'kitchen-pos',
      current: { application: 'Netflix', tunnel: 'vti-fiber1' },
      desired: { application: 'Netflix', tunnel: 'vti-cell1' },
      origin: 2, // ROUTE_ORIGIN_ADVISOR_AI
      advisor_reason: 'vti-cell1 at 38 ms carries 1 app vs vti-fiber1 crowded at 3 apps.',
      expected_gain_ms: 8.4,
      freeze: false,
    },
    {
      client_mac: 'aa:bb:cc:00:00:01',
      client_name: 'front-desk',
      current: { application: 'Microsoft Teams', tunnel: 'vti-fiber2' },
      desired: { application: 'Microsoft Teams', tunnel: 'vti-fiber1' },
      origin: 1, // ROUTE_ORIGIN_OPERATOR
      advisor_reason: '',
      expected_gain_ms: 0,
      freeze: false,
    },
  ],
  freezes: [
    { client_mac: 'aa:bb:cc:00:00:05', client_name: 'dock-door', application: 'OT Telemetry', freeze: true, tunnel: 'vti-cell2' },
  ],
};
const bytes = encodeAppRouteCommand(cmd);
const decoded = decodeAppRouteCommand(bytes);
check('round-trip equality', canon(decoded) === canon(cmd),
  `decoded ${JSON.stringify(decoded)}`);
check('payload is compact', bytes.length > 0 && bytes.length < 512, `${bytes.length} bytes`);

/* 3 — proto3 defaults: zero/empty fields are omitted on the wire but decode
 *     back to defaults */
const sparse = encodeAppRouteCommand({ timestamp_ms: 0, source: '', gateway: '', changes: [] });
check('defaults omitted on the wire', sparse.length === 0, `${sparse.length} bytes`);
const sparseBack = decodeAppRouteCommand(sparse);
check('defaults restored on decode',
  sparseBack.timestamp_ms === 0 && sparseBack.source === '' && sparseBack.changes.length === 0);

/* 3b — an UNFREEZE must still carry the key. proto3 would normally drop a
 *      false, leaving the consumer unable to tell "released" from "absent";
 *      the encoder writes it explicitly. Bytes for
 *      ClientFreeze{client_mac:"m", freeze:false}:
 *        0a 01 6d  (field 1, len 1, "m")   20 00  (field 4, varint 0)   */
const freezeOff = toHex(encodeClientFreeze({ client_mac: 'm', client_name: '', application: '', freeze: false, tunnel: '' }));
check('unfreeze keeps freeze=false on the wire', freezeOff === '0a 01 6d 20 00', `got ${freezeOff}`);

/* 3c — a FREEZE carries the pinned tunnel, so the gateway knows what to hold
 *      the application on: adds 2a 09 "vti-cell2" (field 5, len 9). */
const freezeOn = toHex(encodeClientFreeze({ client_mac: 'm', client_name: '', application: '', freeze: true, tunnel: 'vti-cell2' }));
check('freeze carries the pinned tunnel',
  freezeOn === `0a 01 6d 20 01 2a 09 ${toHex(new TextEncoder().encode('vti-cell2'))}`, `got ${freezeOn}`);

/* 4 — decoder skips unknown trailing fields (forward compatibility):
 *     field 15, varint wire type → tag 0x78, value 0x01 */
const withUnknown = new Uint8Array([...bytes, 0x78, 0x01]);
const decodedUnknown = decodeAppRouteCommand(withUnknown);
check('unknown fields skipped', canon(decodedUnknown) === canon(cmd));

// eslint-disable-next-line no-console
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
