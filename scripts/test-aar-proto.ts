/**
 * Wire-format check for the AAR decoder (server/aarProto.ts) against
 * proto/aar.proto. Run: npx tsx scripts/test-aar-proto.ts
 *
 * A tiny local encoder produces bytes the decoder must read back, plus one
 * hand-computed golden case so the decoder is checked against the proto3 spec
 * and not just its own encoder.
 */

import { decodeTunnel, decodeDecision, decodeFlow, decodeRoute } from '../server/aarProto.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  // eslint-disable-next-line no-console
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

/* minimal proto3 encoder (varint / string / int32) for round-tripping */
function varint(v: number, out: number[]) {
  let n = v >>> 0;                 // test values are small, non-negative
  do { const b = n & 0x7f; n >>>= 7; out.push(n ? b | 0x80 : b); } while (n);
}
function str(field: number, s: string, out: number[]) {
  if (!s) return;
  const bytes = new TextEncoder().encode(s);
  varint((field << 3) | 2, out); varint(bytes.length, out); out.push(...bytes);
}
function i32(field: number, v: number, out: number[]) {
  if (!v) return;
  varint((field << 3) | 0, out); varint(v, out);
}

/* 1 — golden bytes for Tunnel{ iface:"vti-fiber1", latency_ms:4 }:
 *   0a 0a <"vti-fiber1"> 10 04                                            */
const goldenTunnel = new Uint8Array([0x0a, 0x0a, ...new TextEncoder().encode('vti-fiber1'), 0x10, 0x04]);
const t = decodeTunnel(goldenTunnel);
check('Tunnel golden decode', t.iface === 'vti-fiber1' && t.latency_ms === 4, JSON.stringify(t));

/* 2 — Decision round-trip through the real decoder */
const decOut: number[] = [];
str(1, '10.0.0.5', decOut); str(2, 'vti-fiber1', decOut); i32(3, 4, decOut);
str(4, '52.3.1.9', decOut); i32(5, 38, decOut); i32(6, 42, decOut);
const d = decodeDecision(new Uint8Array(decOut));
check('Decision round-trip',
  d.src_ip === '10.0.0.5' && d.tunnel === 'vti-fiber1' && d.tunnel_latency_ms === 4 &&
  d.dst_ip === '52.3.1.9' && d.dst_latency_ms === 38 && d.total_latency_ms === 42, JSON.stringify(d));

/* 3 — Flow + Route + multi-byte UTF-8 in a string length (byte len != char len) */
const flowOut: number[] = []; str(1, '10.0.0.5', flowOut); str(2, 'ünïcøde.example', flowOut);
const f = decodeFlow(new Uint8Array(flowOut));
check('Flow UTF-8 string', f.src_ip === '10.0.0.5' && f.dst_ip === 'ünïcøde.example', JSON.stringify(f));

const routeOut: number[] = []; str(1, '52.3.1.9', routeOut); i32(2, 38, routeOut); str(3, 'vti-cell2', routeOut);
const r = decodeRoute(new Uint8Array(routeOut));
check('Route round-trip', r.dst_ip === '52.3.1.9' && r.latency_ms === 38 && r.via === 'vti-cell2', JSON.stringify(r));

/* 4 — decoder skips unknown trailing fields (forward compat) */
const withUnknown = new Uint8Array([...decOut, 0x78, 0x01]); // field 15 varint
const du = decodeDecision(withUnknown);
check('unknown fields skipped', du.src_ip === '10.0.0.5' && du.total_latency_ms === 42);

// eslint-disable-next-line no-console
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
