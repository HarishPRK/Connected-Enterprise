import { z } from 'zod';

export const STOCK_ROWS = 5;
export const STOCK_COLUMNS = 8;
const finite = () => z.number().finite();

/** Canonical v1 wire contract. Temperatures are °C, pressure is discharge gauge bar. */
export const telemetrySchema = z.object({
  schemaVersion: z.literal(1),
  deviceId: z.string().min(1).max(100),
  sequence: z.number().int().nonnegative(),
  timestamp: z.string().datetime(),
  source: z.enum(['simulator', 'hardware']),
  doorOpen: z.boolean(),
  temperature: z.object({
    top: finite().min(-40).max(80),
    middle: finite().min(-40).max(80),
    bottom: finite().min(-40).max(80),
    setpoint: finite().min(2).max(6),
    ambient: finite().min(-20).max(60),
  }).strict(),
  humidity: finite().min(0).max(100),
  compressor: z.object({
    running: z.boolean(),
    currentAmps: finite().min(0).max(50),
    pressureBar: finite().min(-1).max(60),
    dutyCycle: finite().min(0).max(100),
    runtimeSeconds: finite().nonnegative(),
    vibrationHz: finite().min(0).max(10000),
  }).strict(),
  stock: z.array(z.array(z.boolean()).length(STOCK_COLUMNS)).length(STOCK_ROWS),
  powerWatts: finite().min(0).max(20000),
  energyKwh: finite().nonnegative(),
  alarms: z.array(z.object({
    id: z.string().min(1).max(100),
    severity: z.enum(['warning', 'critical']),
    message: z.string().min(1).max(300),
  }).strict()).max(32),
}).strict();

const commandBase = { type: z.literal('command'), id: z.string().min(1).max(80) };
export const commandSchema = z.discriminatedUnion('command', [
  z.object({ ...commandBase, command: z.literal('set-door'), value: z.boolean() }).strict(),
  z.object({ ...commandBase, command: z.literal('set-setpoint'), value: finite().min(2).max(6) }).strict(),
  z.object({ ...commandBase, command: z.literal('set-stock'), value: z.object({
    row: z.number().int().min(0).max(STOCK_ROWS - 1),
    col: z.number().int().min(0).max(STOCK_COLUMNS - 1),
    filled: z.boolean(),
  }).strict() }).strict(),
  z.object({ ...commandBase, command: z.literal('restock') }).strict(),
  z.object({ ...commandBase, command: z.literal('reset') }).strict(),
]);

export const ackSchema = z.object({
  type: z.literal('ack'),
  id: z.string().min(1).max(80),
  ok: z.boolean(),
  error: z.string().max(300).optional(),
}).strict();
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('telemetry'), data: telemetrySchema }).strict(),
  ackSchema,
]);

export type Telemetry = z.infer<typeof telemetrySchema>;
export type CoolerCommand = z.infer<typeof commandSchema>;
export type Command = CoolerCommand;
export type CommandAck = z.infer<typeof ackSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
