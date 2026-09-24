import { Activity, Cloud, GitBranch, Leaf, Network, ShieldCheck, Zap } from 'lucide-react';
import type { ScenarioId } from './scenePrimitives';

type Sensor = { name: string; detail: string; states: readonly [string, string, string, string] };
export const TWIN_SCENARIOS: Record<ScenarioId, { icon: typeof Activity; color: string; sensors: Sensor[] }> = {
  safety: { icon: ShieldCheck, color: 'coral', sensors: [
    { name: 'Aisle camera', detail: 'Video inference', states: ['Monitoring', 'Fall unobserved', 'Possible fall', 'Assistance sent'] },
    { name: 'Edge inference', detail: 'Local video processing', states: ['Scene input', 'No response', 'Fall identified', 'Event retained'] },
    { name: 'Operator alert', detail: 'Staff response', states: ['No alert', 'No alert', 'Review required', 'Colleague assisting'] },
  ] },
  connectivity: { icon: GitBranch, color: 'cyan', sensors: [
    { name: 'Primary uplink', detail: 'Path health', states: ['Link failure', 'Unavailable', 'Unhealthy', 'Unavailable'] },
    { name: 'Cellular uplink', detail: 'Alternate connection', states: ['Standby', 'Standby', 'Selected', 'Active'] },
    { name: 'Checkout terminal', detail: 'Payment traffic', states: ['Payment waiting', 'Interrupted', 'Retry ready', 'Payment complete'] },
  ] },
  energy: { icon: Zap, color: 'amber', sensors: [
    { name: 'Energy meter', detail: 'Equipment demand', states: ['Rising load', 'Above baseline', 'Anomaly flagged', 'Stabilized'] },
    { name: 'Temperature sensor', detail: 'Cooling demand', states: ['Cooling active', 'Demand persists', 'Under review', 'Setpoint adjusted'] },
    { name: 'Plant controller', detail: 'Equipment operation', states: ['Running', 'Unchanged', 'Technician notified', 'Monitoring'] },
  ] },
  leak: { icon: Leaf, color: 'mint', sensors: [
    { name: 'Presence sensor', detail: 'Room occupancy', states: ['Last person leaves', 'Room empty', 'Vacancy confirmed', 'Unoccupied'] },
    { name: 'Daylight sensor', detail: 'Available natural light', states: ['Daylight available', 'Lights still on', 'Policy input', 'Lighting reduced'] },
    { name: 'Power monitor', detail: 'Lighting & plug loads', states: ['Demand continues', 'Idle consumption', 'Waste identified', 'Demand reduced'] },
    { name: 'Climate control', detail: 'Temperature setpoint', states: ['Cooling active', 'Empty-room cooling', 'Setback requested', 'Eco mode'] },
  ] },
  matter: { icon: Network, color: 'lilac', sensors: [
    { name: 'Presence · OEM A', detail: 'Thread', states: ['Independent', 'Room empty', 'Commissioned', 'Vacancy shared'] },
    { name: 'Lighting · OEM B', detail: 'Wi-Fi', states: ['Independent', 'Still on', 'Commissioned', 'Dimmed'] },
    { name: 'Climate · OEM C', detail: 'Wi-Fi', states: ['Independent', 'Still cooling', 'Commissioned', 'Eco mode'] },
    { name: 'Shades · OEM D', detail: 'Thread', states: ['Independent', 'Open', 'Commissioned', 'Lowered'] },
  ] },
  eagle: { icon: Activity, color: 'rose', sensors: [
    { name: 'CPU telemetry', detail: 'Gateway resources', states: ['Load rising', 'Under pressure', 'Pattern analyzed', 'Flagged for review'] },
    { name: 'Work queue', detail: 'Local processing', states: ['Growing', 'Delayed work', 'Anomaly detected', 'Investigation'] },
    { name: 'Equipment context', detail: 'Operator diagnostics', states: ['Raw readings', 'No diagnosis', 'Context added', 'Operator reviewing'] },
  ] },
  greengrass: { icon: Cloud, color: 'blue', sensors: [
    { name: 'Stockroom scanner', detail: 'Local samples', states: ['Collecting', 'Collecting', 'Local processing', 'Collecting'] },
    { name: 'Cloud link', detail: 'Upstream connectivity', states: ['Link lost', 'Offline', 'Offline', 'Restored'] },
    { name: 'Local buffer', detail: 'Retained results', states: ['Retaining', 'Queued locally', 'Processing', 'Synchronized'] },
  ] },
};

export const WATER_SENSORS: Sensor[] = [
  { name: 'Water sensor', detail: 'Utility floor', states: ['Water escaping', 'Leak unobserved', 'Water detected', 'Inspection needed'] },
  { name: 'Isolation valve', detail: 'Water supply control', states: ['Open', 'Open', 'Close requested', 'Supply isolated'] },
  { name: 'Operator alert', detail: 'Maintenance response', states: ['No alert', 'No alert', 'Leak located', 'Cleanup required'] },
];
