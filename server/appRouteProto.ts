/**
 * Hand-rolled proto3 DECODER for the app-route steering command
 * (proto/app_route.proto). /api/approute/publish receives the binary payload
 * the browser encoded (src/proto/appRoute.ts), decodes it here to validate
 * and log it, then relays the raw bytes to `<source>/approute/control`.
 *
 * Mirrors the reader style of the ipsec_metrics decoder — same no-protobufjs
 * policy.
 */

export interface TunnelBinding {
  application: string;
  tunnel: string;
}

export interface ClientRouteChange {
  client_mac: string;
  client_name: string;
  current: TunnelBinding;
  desired: TunnelBinding;
}

export interface AppRouteCommand {
  timestamp_ms: number;
  source: string;
  gateway: string;
  changes: ClientRouteChange[];
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

/* ───────── message decoders ───────── */

function decodeTunnelBinding(buf: Uint8Array): TunnelBinding {
  const out: TunnelBinding = { application: '', tunnel: '' };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 2) out.application = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 2 && wire === 2) out.tunnel = new TextDecoder().decode(readLengthDelimited(r));
    else skipField(r, wire);
  }
  return out;
}

function decodeClientRouteChange(buf: Uint8Array): ClientRouteChange {
  const out: ClientRouteChange = {
    client_mac: '', client_name: '',
    current: { application: '', tunnel: '' },
    desired: { application: '', tunnel: '' },
  };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 2) out.client_mac = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 2 && wire === 2) out.client_name = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 3 && wire === 2) out.current = decodeTunnelBinding(readLengthDelimited(r));
    else if (field === 4 && wire === 2) out.desired = decodeTunnelBinding(readLengthDelimited(r));
    else skipField(r, wire);
  }
  return out;
}

export function decodeAppRouteCommand(buf: Uint8Array): AppRouteCommand {
  const out: AppRouteCommand = { timestamp_ms: 0, source: '', gateway: '', changes: [] };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 0) out.timestamp_ms = Number(readVarint(r));
    else if (field === 2 && wire === 2) out.source = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 3 && wire === 2) out.gateway = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 4 && wire === 2) out.changes.push(decodeClientRouteChange(readLengthDelimited(r)));
    else skipField(r, wire);
  }
  return out;
}
