import { CheckCircle2, AlertTriangle, CircleOff, MinusCircle, Laptop, Monitor, Printer, CreditCard, Server, PhoneCall, Flame, Wind, DoorClosed, Smartphone, Tablet, Cpu, Plug, Boxes } from 'lucide-react';
import type { Device } from '../../types';

export const kinds = {
  laptop: { label: 'Laptops', icon: Laptop }, desktop: { label: 'Desktops', icon: Monitor },
  printer: { label: 'Printers', icon: Printer }, payment: { label: 'Payment terminals', icon: CreditCard },
  server: { label: 'Servers', icon: Server }, confphone: { label: 'Conference phones', icon: PhoneCall },
  fire_sensor: { label: 'Fire sensors', icon: Flame }, smoke_sensor: { label: 'Smoke sensors', icon: Wind },
  door_lock: { label: 'Door locks', icon: DoorClosed }, phone: { label: 'Phones', icon: Smartphone },
  tablet: { label: 'Tablets', icon: Tablet }, matter: { label: 'Matter devices', icon: Cpu },
  shelly: { label: 'Shelly devices', icon: Plug }, generic: { label: 'Other devices', icon: Boxes },
} satisfies Record<Device['kind'], { label: string; icon: typeof Laptop }>;

export const states = [
  { id: 'ok', label: 'Healthy', icon: CheckCircle2 },
  { id: 'warn', label: 'Attention', icon: AlertTriangle },
  { id: 'err', label: 'Offline', icon: CircleOff },
  { id: 'off', label: 'Inactive', icon: MinusCircle },
] as const;

export function countStates(devices: Device[]) {
  const counts = { ok: 0, warn: 0, err: 0, off: 0 };
  for (const device of devices) counts[device.status] += 1;
  return counts;
}
