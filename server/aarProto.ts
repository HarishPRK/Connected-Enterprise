/**
 * Hand-rolled proto3 DECODER for the AAR routing telemetry (proto/aar.proto).
 * The gateway's AAR plugin publishes these as binary proto3 on `routing/flow`,
 * `routing/tunnel`, `routing/route`, `routing/decision`; ipsecSource subscribes,
 * decodes with `decodeAarMessage(topic, bytes)`, and exposes the aggregated
 * state on /api/aar/{snapshot,stream}. Same reader style + no-protobufjs policy
 * as ipsecProto.ts.
 */

export interface AarFlow {
  src_ip: string;
  dst_ip: string;
}

export interface AarTunnel {
  iface: string;
  latency_ms: number;
}

export interface AarRoute {
  dst_ip: string;
  latency_ms: number;
  via: string;
}

export interface AarDecision {
  src_ip: string;
  tunnel: string;
  tunnel_latency_ms: number;
  dst_ip: string;
  dst_latency_ms: number;
  total_latency_ms: number;
}

/** Clean JSON shape fanned out to the browser over SSE. */
export interface AarSnapshot {
  tunnels: (AarTunnel & { updatedAt: number })[];
  decisions: (AarDecision & { updatedAt: number })[];
  routes: (AarRoute & { updatedAt: number })[];
  flows: (AarFlow & { updatedAt: number })[];
  connected: boolean;
  receivedAt: number;
}

/* ───────── low-level wire decoding ───────── */

type Reader = { buf: Uint8Array; pos: number };

function readVarint(r: Reader): bigint {
  let result = 0n;
  let shift = 0n;
  while (r.pos < r.buf.length) {
    const b = r.buf[r.pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return result;
    shift += 7n;
    if (shift > 70n) throw new Error('varint too long');
  }
  throw new Error('unexpected end of buffer while reading varint');
}

function readLengthDelimited(r: Reader): Uint8Array {
  const len = Number(readVarint(r));
  if (r.pos + len > r.buf.length) throw new Error('unexpected end of buffer');
  const out = r.buf.subarray(r.pos, r.pos + len);
  r.pos += len;
  return out;
}

/** proto3 int32 — negatives are sign-extended to 64 bits on the wire. */
function readInt32(r: Reader): number {
  return Number(BigInt.asIntN(64, readVarint(r)));
}

function skipField(r: Reader, wireType: number): void {
  switch (wireType) {
    case 0: readVarint(r); return;
    case 1: r.pos += 8; return;
    case 2: { const n = Number(readVarint(r)); r.pos += n; return; }
    case 5: r.pos += 4; return;
    default: throw new Error(`unknown wire type ${wireType}`);
  }
}

function* fields(buf: Uint8Array): Generator<{ field: number; wire: number; r: Reader }> {
  const r: Reader = { buf, pos: 0 };
  while (r.pos < buf.length) {
    const tag = Number(readVarint(r));
    yield { field: tag >>> 3, wire: tag & 0x7, r };
  }
}

const str = (r: Reader) => new TextDecoder().decode(readLengthDelimited(r));

/* ───────── message decoders ───────── */

export function decodeFlow(buf: Uint8Array): AarFlow {
  const out: AarFlow = { src_ip: '', dst_ip: '' };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 2) out.src_ip = str(r);
    else if (field === 2 && wire === 2) out.dst_ip = str(r);
    else skipField(r, wire);
  }
  return out;
}

export function decodeTunnel(buf: Uint8Array): AarTunnel {
  const out: AarTunnel = { iface: '', latency_ms: 0 };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 2) out.iface = str(r);
    else if (field === 2 && wire === 0) out.latency_ms = readInt32(r);
    else skipField(r, wire);
  }
  return out;
}

export function decodeRoute(buf: Uint8Array): AarRoute {
  const out: AarRoute = { dst_ip: '', latency_ms: 0, via: '' };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 2) out.dst_ip = str(r);
    else if (field === 2 && wire === 0) out.latency_ms = readInt32(r);
    else if (field === 3 && wire === 2) out.via = str(r);
    else skipField(r, wire);
  }
  return out;
}

export function decodeDecision(buf: Uint8Array): AarDecision {
  const out: AarDecision = {
    src_ip: '', tunnel: '', tunnel_latency_ms: 0,
    dst_ip: '', dst_latency_ms: 0, total_latency_ms: 0,
  };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 2) out.src_ip = str(r);
    else if (field === 2 && wire === 2) out.tunnel = str(r);
    else if (field === 3 && wire === 0) out.tunnel_latency_ms = readInt32(r);
    else if (field === 4 && wire === 2) out.dst_ip = str(r);
    else if (field === 5 && wire === 0) out.dst_latency_ms = readInt32(r);
    else if (field === 6 && wire === 0) out.total_latency_ms = readInt32(r);
    else skipField(r, wire);
  }
  return out;
}

export type AarKind = 'flow' | 'tunnel' | 'route' | 'decision';

/** Dispatch on the topic's last segment (`routing/<kind>`). */
export function decodeAarMessage(
  kind: AarKind,
  buf: Uint8Array,
): AarFlow | AarTunnel | AarRoute | AarDecision {
  switch (kind) {
    case 'flow':     return decodeFlow(buf);
    case 'tunnel':   return decodeTunnel(buf);
    case 'route':    return decodeRoute(buf);
    case 'decision': return decodeDecision(buf);
  }
}
