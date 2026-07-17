/**
 * Hand-rolled proto3 ENCODER for the app-route steering command
 * (proto/app_route.proto). The Application Steering Patchboard builds an
 * AppRouteCommand when the operator re-patches a client's wire, encodes it
 * here to binary proto3, and POSTs the bytes to /api/approute/publish which
 * relays them to `<source>/approute/control` over MQTT.
 *
 * Same policy as the ipsec_metrics decoder: the schema is tiny and stable,
 * so we write the wire format by hand instead of adding protobufjs.
 * server/appRouteProto.ts is the matching decoder.
 */

export interface TunnelBinding {
  /** e.g. "Netflix", "Microsoft Teams" */
  application: string;
  /** Tunnel ifname exactly as reported on `<source>/ipsec/metrics`, e.g. "vti-fiber1". */
  tunnel: string;
}

/** proto enum RouteOrigin — who initiated the change. */
export type RouteOrigin = 0 | 1 | 2 | 3;
export const ROUTE_ORIGIN = {
  unspecified: 0,
  operator: 1,
  advisorAi: 2,
  advisorHeuristic: 3,
} as const satisfies Record<string, RouteOrigin>;

export interface ClientRouteChange {
  client_mac: string;
  client_name: string;
  current: TunnelBinding;
  desired: TunnelBinding;
  /** Operator drag vs AI-advisor-applied (field 5). */
  origin?: RouteOrigin;
  /** Advisor's cited reasoning, advisor origins only (field 6). */
  advisor_reason?: string;
  /** Advisor's net latency gain incl. modeled load, ms (field 7, double). */
  expected_gain_ms?: number;
}

/** Routing lock toggle for one client's application (gateway should enforce). */
export interface ClientFreeze {
  client_mac: string;
  client_name: string;
  application: string;
  frozen: boolean;
}

export interface AppRouteCommand {
  timestamp_ms: number;
  /** Topic family the command publishes under: rdk = Plano, prpl = McKinney. */
  source: string;
  /** Gateway name from ipsec metrics. */
  gateway: string;
  changes: ClientRouteChange[];
  /** Freeze toggles — may be published without any route changes (field 5). */
  freezes?: ClientFreeze[];
}

/* ───────── low-level wire encoding ───────── */

class Writer {
  private out: number[] = [];

  /** Little-endian groups of 7 bits, MSB = continuation. */
  varint(v: number | bigint): this {
    let b = typeof v === 'bigint' ? v : BigInt(Math.floor(v));
    if (b < 0n) throw new Error('negative varint not supported by this schema');
    do {
      const byte = Number(b & 0x7fn);
      b >>= 7n;
      this.out.push(b > 0n ? byte | 0x80 : byte);
    } while (b > 0n);
    return this;
  }

  tag(field: number, wire: number): this {
    return this.varint((field << 3) | wire);
  }

  /** proto3 scalars skip default values — empty strings are not emitted. */
  string(field: number, s: string): this {
    if (!s) return this;
    const bytes = new TextEncoder().encode(s);
    this.tag(field, 2).varint(bytes.length);
    for (const b of bytes) this.out.push(b);
    return this;
  }

  uint64(field: number, v: number): this {
    if (!v) return this;
    return this.tag(field, 0).varint(v);
  }

  bool(field: number, v: boolean): this {
    if (!v) return this; // proto3 default (false) is omitted
    return this.tag(field, 0).varint(1);
  }

  /** IEEE 754 double, fixed64 little-endian (wire type 1). */
  double(field: number, v: number): this {
    if (!v) return this;
    this.tag(field, 1);
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    for (const x of b) this.out.push(x);
    return this;
  }

  /** Length-delimited submessage. Presence is meaningful, so empty bodies still emit. */
  message(field: number, body: Uint8Array): this {
    this.tag(field, 2).varint(body.length);
    for (const b of body) this.out.push(b);
    return this;
  }

  // `Uint8Array<ArrayBuffer>` (not ArrayBufferLike) so callers can pass the
  // result straight to fetch() as a BodyInit under TS 6's DOM types.
  bytes(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.out);
  }
}

/* ───────── message encoders ───────── */

export function encodeTunnelBinding(b: TunnelBinding): Uint8Array<ArrayBuffer> {
  return new Writer()
    .string(1, b.application)
    .string(2, b.tunnel)
    .bytes();
}

export function encodeClientRouteChange(c: ClientRouteChange): Uint8Array<ArrayBuffer> {
  return new Writer()
    .string(1, c.client_mac)
    .string(2, c.client_name)
    .message(3, encodeTunnelBinding(c.current))
    .message(4, encodeTunnelBinding(c.desired))
    .uint64(5, c.origin ?? 0)
    .string(6, c.advisor_reason ?? '')
    .double(7, c.expected_gain_ms ?? 0)
    .bytes();
}

export function encodeClientFreeze(f: ClientFreeze): Uint8Array<ArrayBuffer> {
  return new Writer()
    .string(1, f.client_mac)
    .string(2, f.client_name)
    .string(3, f.application)
    .bool(4, f.frozen)
    .bytes();
}

export function encodeAppRouteCommand(cmd: AppRouteCommand): Uint8Array<ArrayBuffer> {
  const w = new Writer()
    .uint64(1, cmd.timestamp_ms)
    .string(2, cmd.source)
    .string(3, cmd.gateway);
  for (const c of cmd.changes) w.message(4, encodeClientRouteChange(c));
  for (const f of cmd.freezes ?? []) w.message(5, encodeClientFreeze(f));
  return w.bytes();
}

/* ───────── display helpers ───────── */

/** "0a 01 41 12 01 42 …" — the console strip renders these as the wire view. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
}
