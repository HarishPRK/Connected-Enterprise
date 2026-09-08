import { randomUUID } from 'node:crypto';
import mqtt, { type MqttClient } from 'mqtt';
import { ackSchema, telemetrySchema, type CommandAck, type CoolerCommand, type Telemetry } from '../shared/telemetry.js';

export interface HardwareOptions {
  url: string;
  deviceId: string;
  commandsEnabled: boolean;
  username?: string;
  password?: string;
  onTelemetry: (data: Telemetry) => void;
  onStatus?: (message: string) => void;
}

/** Pure ingress guard, shared by the broker adapter and contract tests. */
export function validateHardwareTelemetry(payload: unknown, deviceId: string, lastTimestamp: number, now = Date.now()): Telemetry | null {
  const result = telemetrySchema.safeParse(payload);
  if (!result.success || result.data.source !== 'hardware' || result.data.deviceId !== deviceId) return null;
  const timestamp = Date.parse(result.data.timestamp);
  if (timestamp <= lastTimestamp || timestamp < now - 120_000 || timestamp > now + 10_000) return null;
  return result.data;
}

/** MQTT edge boundary: publish success is NOT a device acknowledgement. */
export class MqttHardwareAdapter {
  private client?: MqttClient;
  private lastTimestamp = 0;
  private pending = new Map<string, { resolve: (ack: CommandAck) => void; timer: ReturnType<typeof setTimeout>; originalId: string }>();
  private readonly baseTopic: string;
  connected = false;
  rejectedPackets = 0;

  constructor(private readonly options: HardwareOptions) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(options.deviceId)) throw new Error('MQTT device ID must contain only letters, digits, _ or -');
    this.baseTopic = `coolers/${options.deviceId}`;
  }

  start() {
    const { options } = this;
    this.client = mqtt.connect(options.url, {
      clientId: `twin-${options.deviceId}-${randomUUID().slice(0, 8)}`,
      username: options.username, password: options.password,
      reconnectPeriod: 2000, connectTimeout: 10_000, clean: true,
      rejectUnauthorized: true,
    });
    this.client.on('connect', () => {
      this.connected = true;
      this.client!.subscribe([`${this.baseTopic}/telemetry`, `${this.baseTopic}/ack`], { qos: 1 }, (error) => {
        if (error) { this.connected = false; options.onStatus?.('MQTT subscription failed'); }
      });
      options.onStatus?.('MQTT connected');
    });
    this.client.on('offline', () => { this.connected = false; this.rejectPending('Hardware connection is offline.'); });
    this.client.on('close', () => { this.connected = false; });
    this.client.on('error', () => options.onStatus?.('MQTT connection error; reconnecting'));
    this.client.on('message', (topic, bytes) => {
      if (bytes.length > 16_384) { this.rejectedPackets++; return; }
      let payload: unknown;
      try { payload = JSON.parse(bytes.toString()); } catch { this.rejectedPackets++; return; }
      if (topic === `${this.baseTopic}/telemetry`) {
        const data = validateHardwareTelemetry(payload, options.deviceId, this.lastTimestamp);
        if (!data) { this.rejectedPackets++; return; }
        this.lastTimestamp = Date.parse(data.timestamp);
        options.onTelemetry(data);
      } else if (topic === `${this.baseTopic}/ack`) {
        const result = ackSchema.safeParse(payload);
        if (!result.success) { this.rejectedPackets++; return; }
        const pending = this.pending.get(result.data.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(result.data.id);
        pending.resolve({ ...result.data, id: pending.originalId });
      }
    });
  }

  async command(command: CoolerCommand): Promise<CommandAck> {
    const fail = (error: string): CommandAck => ({ type: 'ack', id: command.id, ok: false, error });
    if (!this.options.commandsEnabled) return fail('Hardware control is disabled on this gateway.');
    if (command.command !== 'set-setpoint') return fail('This command is simulation-only. The physical device reports its door and stock sensors.');
    if (!this.connected || !this.client) return fail('Hardware connection is offline.');
    if (this.pending.size >= 32) return fail('Too many pending device commands.');
    const gatewayId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(gatewayId);
        resolve(fail('Device acknowledgement timed out; verify the next sensor reading.'));
      }, 8000);
      timer.unref();
      this.pending.set(gatewayId, { resolve, timer, originalId: command.id });
      this.client!.publish(`${this.baseTopic}/command`, JSON.stringify({ ...command, id: gatewayId }), { qos: 1, retain: false }, (error) => {
        if (!error) return;
        const pending = this.pending.get(gatewayId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(gatewayId);
        resolve(fail('Could not deliver command to the hardware broker.'));
      });
    });
  }

  private rejectPending(error: string) {
    for (const { resolve, timer, originalId } of this.pending.values()) {
      clearTimeout(timer);
      resolve({ type: 'ack', id: originalId, ok: false, error });
    }
    this.pending.clear();
  }

  async close() {
    this.connected = false;
    this.rejectPending('Telemetry gateway is shutting down.');
    if (this.client) await this.client.endAsync(true);
  }
}
