/**
 * Hand-rolled proto3 decoder for the IPsec metrics schema.
 *
 * The on-the-wire payload is produced by the gateway from this schema:
 *
 *   message GatewayMetric { string name=1; string mac=2;
 *                           string prim_wan_ip=3; string sec_wan_ip=4; }
 *   message TunnelMetric  { string ifname=1; bool present=2; bool reachable=3;
 *                           double latency_ms=4; double loss_percent=5;
 *                           uint64 rx_bytes=6; uint64 tx_bytes=7; }
 *   message WanMetric     { string ifname=1; bool link_up=2;
 *                           uint64 rx_bytes=3; uint64 tx_bytes=4;
 *                           uint64 rx_packets=5; uint64 tx_packets=6; }
 *   message IpsecMetrics  { uint64 timestamp_ms=1; string active_tunnel=2;
 *                           uint32 tunnel_count=3; repeated TunnelMetric tunnels=4;
 *                           WanMetric wan=5; GatewayMetric gateway=6; }
 *
 * We avoid adding a `protobufjs` dependency since this schema is tiny and
 * stable. If it grows, swap this for `protobufjs` and load the .proto file.
 */

import type {
  IpsecGatewayMetric,
  IpsecMetrics,
  IpsecTunnelMetric,
  IpsecWanMetric,
  IpsecWifiClient,
  IpsecWifiMetrics,
} from '../src/types.js';

/* ───────── low-level wire decoding ───────── */

type Reader = { buf: Uint8Array; pos: number };

function readVarint(r: Reader): bigint {
  let result = 0n;
  let shift = 0n;
  // Proto varints are little-endian groups of 7 bits, MSB=continuation.
  while (r.pos < r.buf.length) {
    const b = r.buf[r.pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return result;
    shift += 7n;
    if (shift > 70n) throw new Error('varint too long');
  }
  throw new Error('unexpected end of buffer while reading varint');
}

function readBytes(r: Reader, n: number): Uint8Array {
  if (r.pos + n > r.buf.length) throw new Error('unexpected end of buffer');
  const out = r.buf.subarray(r.pos, r.pos + n);
  r.pos += n;
  return out;
}

function readFixed64(r: Reader): Uint8Array { return readBytes(r, 8); }
function readFixed32(r: Reader): Uint8Array { return readBytes(r, 4); }

function readLengthDelimited(r: Reader): Uint8Array {
  const len = Number(readVarint(r));
  return readBytes(r, len);
}

function readDouble(r: Reader): number {
  const b = readFixed64(r);
  // The 8 fixed bytes are a little-endian IEEE 754 double.
  return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true);
}

/** proto3 `int32` — negatives are encoded sign-extended to 64 bits, so read the
 *  varint and interpret it as a signed 64-bit value (which fits int32). */
function readInt32(r: Reader): number {
  return Number(BigInt.asIntN(64, readVarint(r)));
}

/** Skip a single field whose tag has already been consumed. */
function skipField(r: Reader, wireType: number): void {
  switch (wireType) {
    case 0: readVarint(r); return;             // varint
    case 1: r.pos += 8; return;                 // fixed64
    case 2: { const n = Number(readVarint(r)); r.pos += n; return; } // length-delimited
    case 5: r.pos += 4; return;                 // fixed32
    default: throw new Error(`unknown wire type ${wireType}`);
  }
}

/** Iterate fields of a length-delimited message body. */
function* fields(buf: Uint8Array): Generator<{ field: number; wire: number; r: Reader }> {
  const r: Reader = { buf, pos: 0 };
  while (r.pos < buf.length) {
    const tag = Number(readVarint(r));
    yield { field: tag >>> 3, wire: tag & 0x7, r };
  }
}

/* ───────── message decoders ───────── */

function decodeGateway(buf: Uint8Array): IpsecGatewayMetric {
  const out: IpsecGatewayMetric = { name: '', mac: '', prim_wan_ip: '', sec_wan_ip: '' };
  for (const { field, wire, r } of fields(buf)) {
    if (wire === 2) {
      const s = new TextDecoder().decode(readLengthDelimited(r));
      if      (field === 1) out.name = s;
      else if (field === 2) out.mac = s;
      else if (field === 3) out.prim_wan_ip = s;
      else if (field === 4) out.sec_wan_ip = s;
    } else {
      skipField(r, wire);
    }
  }
  return out;
}

function decodeTunnel(buf: Uint8Array): IpsecTunnelMetric {
  const out: IpsecTunnelMetric = {
    ifname: '', present: false, reachable: false,
    latency_ms: 0, loss_percent: 0, rx_bytes: 0, tx_bytes: 0,
  };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 2) out.ifname = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 2 && wire === 0) out.present = readVarint(r) !== 0n;
    else if (field === 3 && wire === 0) out.reachable = readVarint(r) !== 0n;
    else if (field === 4 && wire === 1) out.latency_ms = readDouble(r);
    else if (field === 5 && wire === 1) out.loss_percent = readDouble(r);
    else if (field === 6 && wire === 0) out.rx_bytes = Number(readVarint(r));
    else if (field === 7 && wire === 0) out.tx_bytes = Number(readVarint(r));
    else skipField(r, wire);
  }
  return out;
}

function decodeWan(buf: Uint8Array): IpsecWanMetric {
  const out: IpsecWanMetric = {
    ifname: '', link_up: false,
    rx_bytes: 0, tx_bytes: 0, rx_packets: 0, tx_packets: 0,
  };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 2) out.ifname = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 2 && wire === 0) out.link_up = readVarint(r) !== 0n;
    else if (field === 3 && wire === 0) out.rx_bytes = Number(readVarint(r));
    else if (field === 4 && wire === 0) out.tx_bytes = Number(readVarint(r));
    else if (field === 5 && wire === 0) out.rx_packets = Number(readVarint(r));
    else if (field === 6 && wire === 0) out.tx_packets = Number(readVarint(r));
    else skipField(r, wire);
  }
  return out;
}

function decodeWifiClient(buf: Uint8Array): IpsecWifiClient {
  const out: IpsecWifiClient = {
    mac: '', ip: '', hostname: '', ap_index: 0, ssid: '',
    active: false, authenticated: false, rssi: 0, snr: 0, standard: '',
    downlink_rate: 0, uplink_rate: 0, rx_bytes: 0, tx_bytes: 0,
    rx_packets: 0, tx_packets: 0, errors_sent: 0, retrans_count: 0,
    failed_retrans_count: 0, health: '',
  };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1  && wire === 2) out.mac = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 2  && wire === 2) out.ip = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 3  && wire === 2) out.hostname = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 4  && wire === 0) out.ap_index = Number(readVarint(r));
    else if (field === 5  && wire === 2) out.ssid = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 6  && wire === 0) out.active = readVarint(r) !== 0n;
    else if (field === 7  && wire === 0) out.authenticated = readVarint(r) !== 0n;
    else if (field === 8  && wire === 0) out.rssi = readInt32(r);
    else if (field === 9  && wire === 0) out.snr = readInt32(r);
    else if (field === 10 && wire === 2) out.standard = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 11 && wire === 0) out.downlink_rate = Number(readVarint(r));
    else if (field === 12 && wire === 0) out.uplink_rate = Number(readVarint(r));
    else if (field === 13 && wire === 0) out.rx_bytes = Number(readVarint(r));
    else if (field === 14 && wire === 0) out.tx_bytes = Number(readVarint(r));
    else if (field === 15 && wire === 0) out.rx_packets = Number(readVarint(r));
    else if (field === 16 && wire === 0) out.tx_packets = Number(readVarint(r));
    else if (field === 17 && wire === 0) out.errors_sent = Number(readVarint(r));
    else if (field === 18 && wire === 0) out.retrans_count = Number(readVarint(r));
    else if (field === 19 && wire === 0) out.failed_retrans_count = Number(readVarint(r));
    else if (field === 20 && wire === 2) out.health = new TextDecoder().decode(readLengthDelimited(r));
    else skipField(r, wire);
  }
  return out;
}

function decodeWifi(buf: Uint8Array): IpsecWifiMetrics {
  const out: IpsecWifiMetrics = {
    total_clients: 0, active_clients: 0, weak_signal_clients: 0,
    clients_with_errors: 0, high_retrans_clients: 0, clients: [],
  };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 0) out.total_clients = Number(readVarint(r));
    else if (field === 2 && wire === 0) out.active_clients = Number(readVarint(r));
    else if (field === 3 && wire === 0) out.weak_signal_clients = Number(readVarint(r));
    else if (field === 4 && wire === 0) out.clients_with_errors = Number(readVarint(r));
    else if (field === 5 && wire === 0) out.high_retrans_clients = Number(readVarint(r));
    else if (field === 6 && wire === 2) out.clients.push(decodeWifiClient(readLengthDelimited(r)));
    else skipField(r, wire);
  }
  return out;
}

export function decodeIpsecMetrics(buf: Uint8Array): IpsecMetrics {
  const out: IpsecMetrics = {
    timestamp_ms: 0,
    active_tunnel: '',
    tunnel_count: 0,
    tunnels: [],
    wan:     { ifname: '', link_up: false, rx_bytes: 0, tx_bytes: 0, rx_packets: 0, tx_packets: 0 },
    gateway: { name: '', mac: '', prim_wan_ip: '', sec_wan_ip: '' },
  };
  for (const { field, wire, r } of fields(buf)) {
    if      (field === 1 && wire === 0) out.timestamp_ms = Number(readVarint(r));
    else if (field === 2 && wire === 2) out.active_tunnel = new TextDecoder().decode(readLengthDelimited(r));
    else if (field === 3 && wire === 0) out.tunnel_count = Number(readVarint(r));
    else if (field === 4 && wire === 2) out.tunnels.push(decodeTunnel(readLengthDelimited(r)));
    else if (field === 5 && wire === 2) out.wan = decodeWan(readLengthDelimited(r));
    else if (field === 6 && wire === 2) out.gateway = decodeGateway(readLengthDelimited(r));
    else if (field === 7 && wire === 2) out.wifi = decodeWifi(readLengthDelimited(r));
    else skipField(r, wire);
  }
  return out;
}
