import { z } from 'zod';

export interface ServiceOptions {
  host: string;
  port: number;
  deviceId: string;
  source: 'simulator' | 'hardware';
  allowedOrigins: string[];
  timeScale: number;
  mqttUrl?: string;
  mqttUsername?: string;
  mqttPassword?: string;
  hardwareCommandsEnabled: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServiceOptions {
  const config = z.object({
    HOST: z.enum(['127.0.0.1', '::1']).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3002),
    DEVICE_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).default('GDM-001'),
    TELEMETRY_SOURCE: z.enum(['simulator', 'hardware']).default('simulator'),
    SIMULATION_TIME_SCALE: z.coerce.number().min(0.1).max(30).default(1),
    MQTT_URL: z.string().url().optional(),
    MQTT_USERNAME: z.string().optional(),
    MQTT_PASSWORD: z.string().optional(),
    HARDWARE_COMMANDS_ENABLED: z.enum(['true', 'false']).default('false'),
    ALLOWED_ORIGINS: z.string().default('http://localhost:5180,http://127.0.0.1:5180,http://localhost:4173,http://127.0.0.1:4173,http://localhost:3002,http://127.0.0.1:3002'),
  }).parse(env);
  if (config.TELEMETRY_SOURCE === 'hardware' && !config.MQTT_URL) throw new Error('MQTT_URL is required in hardware mode; simulator fallback is intentionally disabled.');
  if (config.MQTT_URL && !/^(mqtt|mqtts|ws|wss):\/\//.test(config.MQTT_URL)) throw new Error('MQTT_URL must use mqtt, mqtts, ws or wss.');
  const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins.');
  }
  return {
    host: config.HOST, port: config.PORT, deviceId: config.DEVICE_ID, source: config.TELEMETRY_SOURCE,
    timeScale: config.SIMULATION_TIME_SCALE, allowedOrigins,
    mqttUrl: config.MQTT_URL, mqttUsername: config.MQTT_USERNAME, mqttPassword: config.MQTT_PASSWORD,
    hardwareCommandsEnabled: config.HARDWARE_COMMANDS_ENABLED === 'true',
  };
}
