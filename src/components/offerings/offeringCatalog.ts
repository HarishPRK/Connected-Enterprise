import { Activity, ArrowLeftRight, Box, Cable, CircuitBoard, Leaf, Video, type LucideIcon } from 'lucide-react';
export type OfferingId = 'failover' | 'routing' | 'twin' | 'eagle' | 'automation' | 'smart' | 'video';
export interface OfferingVariant {
    id: string;
    label: string;
}
export interface OfferingChapter {
    id: OfferingId;
    title: string;
    navTitle: string;
    category: string;
    icon: LucideIcon;
    color: string;
    intro: string;
    scope: string[];
    variants: OfferingVariant[];
    links: {
        label: string;
        href: string;
    }[];
}
export const OFFERING_CHAPTERS: OfferingChapter[] = [
    {
        id: 'failover', title: 'Dynamic Failover', navTitle: 'Dynamic Failover', category: 'Business continuity', icon: Cable, color: '#7dd3fc',
        intro: 'Keep the branch connected when its primary path changes.',
        scope: ['Fiber + 5G', 'Path health', 'Policy-based recovery'],
        links: [{ label: 'Open Dynamic Failover', href: '/path-selection' }],
        variants: [
            { id: 'fiber', label: 'Fiber interruption' },
            { id: '5g', label: '5G interruption' },
        ]
    },
    {
        id: 'routing', title: 'Application Traffic Routing', navTitle: 'Application Traffic Routing', category: 'Application experience', icon: ArrowLeftRight, color: '#9bcbff',
        intro: 'Keep checkout responsive while the camera archive uploads.',
        scope: ['Application policies', 'Measured path quality', 'Both links online'],
        links: [{ label: 'Open Application Traffic Routing', href: '/app-routing' }],
        variants: [
            { id: 'payment', label: 'Checkout payment' },
            { id: 'orders', label: 'Online orders' },
            { id: 'archive', label: 'Camera archive' },
        ]
    },
    {
        id: 'twin', title: 'Digital Twin for CPE', navTitle: 'Digital Twin for CPE', category: 'Hardware visibility', icon: Box, color: '#b6b9ff',
        intro: 'Trace an interface error from the laptop twin to the physical connection.',
        scope: ['Interface error logs', 'Port inspection', 'Verified recovery', 'Exploded view'],
        links: [{ label: 'Open Gateway Twin', href: '/gateway-twin' }],
        variants: [
            { id: 'assembled', label: 'Assembled' },
            { id: 'exploded', label: 'Exploded' },
        ]
    },
    {
        id: 'eagle', title: 'EA:GLE', navTitle: 'EA:GLE', category: 'Connected operations', icon: Activity, color: '#8bdfcd',
        intro: 'Check detector evidence, then inspect the device behind the slow response.',
        scope: ['MSE & learned threshold', 'Detector flag & reason', 'Connection tracking', 'Physical inspection'],
        links: [{ label: 'Open EA:GLE monitoring', href: '/hardware-anomalies' }, { label: 'IT devices', href: '/it-devices' }, { label: 'OT devices', href: '/ot-devices' }],
        variants: [
            { id: 'gateway', label: 'Gateway HW' },
            { id: 'fiber', label: 'Fiber network' },
            { id: '5g', label: '5G network' },
            { id: 'it', label: 'IT devices' },
            { id: 'ot', label: 'OT devices' },
        ]
    },
    {
        id: 'automation', title: 'Enterprise Device Automation with Interoperability', navTitle: 'Enterprise Device Automation', category: 'Coordinated control', icon: CircuitBoard, color: '#e8bf92',
        intro: 'Close the store. Confirm every load.',
        scope: ['Matter over Wi-Fi', 'Matter over Thread', 'Shelly over MQTT', 'Presence check', 'State confirmation'],
        links: [{ label: 'Explore OT devices', href: '/ot-devices' }],
        variants: [
            { id: 'after-hours', label: 'Close the store' },
            { id: 'occupied', label: 'Someone is still inside' },
        ]
    },
    {
        id: 'smart', title: 'Smart Services', navTitle: 'Smart Services', category: 'Equipment & sustainability', icon: Leaf, color: '#a9d9a0',
        intro: 'Turn equipment signals into earlier, more useful action.',
        scope: ['HVAC predictive maintenance', 'Cooler predictive maintenance', 'Sustainability'],
        links: [{ label: 'Explore connected OT equipment', href: '/ot-devices' }],
        variants: [
            { id: 'hvac', label: 'HVAC maintenance' },
            { id: 'cooler', label: 'Cooler maintenance' },
            { id: 'energy', label: 'Sustainability' },
        ]
    },
    {
        id: 'video', title: 'Video Analytics', navTitle: 'Video Analytics', category: 'Situational awareness', icon: Video, color: '#f2b5c5',
        intro: 'Bring three critical events into the operator’s view.',
        scope: ['Man-down', 'Intruder detection', 'Crowd Monitoring'],
        links: [{ label: 'Open Video Analytics', href: '/video-analytics' }],
        variants: [
            { id: 'man-down', label: 'Man-down' },
            { id: 'intruder', label: 'Intruder detection' },
            { id: 'crowd', label: 'Crowd Monitoring' },
        ]
    },
];
export const COMPONENT_DETAILS: Record<string, {
    title: string;
    detail: string;
    signals: string[];
}> = {
    gateway: { title: 'Edge gateway / CPE', detail: 'The shared point for network policy, local processing and device context.', signals: ['Hardware health', 'Interfaces', 'Local services'] },
    analytics: { title: 'Dell edge analytics server', detail: 'Both cameras feed this dedicated local analytics appliance. Its uplink reaches the shared CPE; detection events support operator review. The chassis is illustrative.', signals: ['Camera A + Camera B', 'Local inference', 'Gateway uplink'] },
    fiber: { title: 'Fiber network', detail: 'The wired uplink connecting the branch to upstream services.', signals: ['Link state', 'Loss & latency', 'Path policy'] },
    '5g': { title: '5G network', detail: 'A distinct cellular path for eligible branch traffic.', signals: ['Registration', 'Signal quality', 'Link state'] },
    cloud: { title: 'Upstream services', detail: 'External applications and services reached through the branch’s uplinks.', signals: ['Reachability', 'Application path'] },
    it: { title: 'IT devices', detail: 'Business endpoints and computing equipment on the branch network.', signals: ['Device health', 'Connectivity', 'Application traffic'] },
    ot: { title: 'OT devices', detail: 'Sensors, controllers and building equipment sharing operational context through the gateway.', signals: ['Device health', 'Connectivity', 'Equipment signals'] },
    pos: { title: 'Payment traffic', detail: 'An application class whose path can be selected through its own routing policy.', signals: ['Application class', 'Eligible paths', 'Route policy'] },
    voice: { title: 'Voice traffic', detail: 'Communication with a route policy informed by link quality and application needs.', signals: ['Latency', 'Jitter', 'Route policy'] },
    video: { title: 'Video traffic', detail: 'A bandwidth-oriented flow with its own policy and preferred connection.', signals: ['Bandwidth', 'Application class', 'Route policy'] },
    housing: { title: 'Gateway enclosure', detail: 'The chassis supports the internal assembly and external interfaces.', signals: ['Mechanical assembly', 'Service access'] },
    board: { title: 'Compute board', detail: 'Processing and memory supporting gateway software and local services.', signals: ['CPU', 'Memory', 'Local processing'] },
    heatsink: { title: 'Thermal assembly', detail: 'The finned surface carries heat away from the electronics through passive cooling.', signals: ['Temperature', 'Thermal condition'] },
    ports: { title: 'Network interfaces', detail: 'Physical connectivity to upstream links and local equipment.', signals: ['Link state', 'RX / TX', 'Interface role'] },
    antennae: { title: 'Radio antennas', detail: 'The internal cellular antenna carrier connects the wireless interface to the backup network.', signals: ['Wireless interface', 'Signal quality'] },
    sensor: { title: 'Occupancy sensor', detail: 'Presence information provides an input to configured automations.', signals: ['Occupancy', 'Device state', 'Event input'] },
    light: { title: 'Connected lighting', detail: 'Lighting responds to an opening or after-hours routine.', signals: ['On / off', 'Dimming', 'Policy response'] },
    lock: { title: 'Access control', detail: 'A compatible lock participating in the example space routine.', signals: ['Access state', 'Command result', 'Policy response'] },
    thermostat: { title: 'Climate control', detail: 'The thermostat applies a comfort or setback state as part of the routine.', signals: ['Setpoint', 'Operating mode', 'Policy response'] },
    'auto-wifi': { title: 'Display plug · Matter over Wi-Fi', detail: 'The display light connects to a Matter-compatible Wi-Fi plug. The illustrative routine sends an Off command, waits for its acknowledgement and then checks the reported switch state.', signals: ['Matter On/Off', 'Wi-Fi connection', 'Requested → acknowledged → observed'] },
    'auto-thread': { title: 'Desk-lamp plug · Matter over Thread', detail: 'A separate Matter plug controls the desk lamp over the Thread mesh. A Thread border router connects that mesh to the IP network; the plug confirms its own switch state.', signals: ['Matter On/Off', 'Thread mesh', 'State confirmation'] },
    'auto-shelly': { title: 'Sign relay · Shelly Plus 1PM', detail: 'The Shelly relay controls the illuminated sign through RPC over MQTT and Wi-Fi. The sign switches off, then its illustrative circuit reading settles from 120 W to 0 W. Shelly is the device brand, not a separate network protocol.', signals: ['Switch.Set over MQTT', 'Wi-Fi connection', 'Switch state + measured power'] },
    'auto-presence': { title: 'Presence sensor · Zigbee', detail: 'The example sensor keeps the closing routine on hold while a colleague remains inside. A clear report and a compressed vacancy dwell are required before any load command is sent. This Zigbee input and presence rule illustrate a proposed integration.', signals: ['Occupied / clear', 'Vacancy dwell', 'Proposed integration'] },
    'auto-controller': { title: 'Closing-routine console', detail: 'The colleague requests closure on the tablet; this wall console tracks each load separately. The illustrative orchestration waits for the presence check, then distinguishes command acknowledgement from observed state. Coolers, networking and walkway lighting are excluded.', signals: ['Tablet close request', 'Presence condition', 'Three independent confirmations'] },
    'auto-bridge': { title: 'Thread border router + Zigbee bridge', detail: 'These are distinct functions: the Thread border router routes IP traffic for Matter devices; the proposed Zigbee bridge supplies presence information. The Shelly device uses its separate MQTT broker connection over Wi-Fi.', signals: ['Thread → IP routing', 'Zigbee presence bridge · proposed', 'Separate MQTT path'] },
    hvac: { title: 'HVAC equipment', detail: 'Condition and consumption signals help identify changes that merit investigation.', signals: ['Temperature', 'Vibration', 'Power pattern'] },
    cooler: { title: 'Commercial cooler', detail: 'Cooling behavior and temperature context support investigation of equipment drift.', signals: ['Temperature', 'Compressor activity', 'Door state'] },
    energy: { title: 'Energy & sustainability', detail: 'Metering connects equipment operation to demand and avoidable consumption.', signals: ['Demand', 'Operating schedule', 'Consumption pattern'] },
    meter: { title: 'Energy meter', detail: 'Consumption measurements provide context for equipment demand and sustainability analysis.', signals: ['Energy use', 'Power demand', 'Operating pattern'] },
    camera: { title: 'Edge-connected camera', detail: 'Camera input supports the selected man-down, intrusion or crowd monitoring example.', signals: ['Video input', 'Defined area', 'Edge inference'] },
    person: { title: 'Person in the monitored area', detail: 'The neutral figure represents a person in an illustrative detection scenario.', signals: ['Scene context', 'Event review'] },
    zone: { title: 'Restricted area', detail: 'A defined boundary provides context for an intrusion event.', signals: ['Zone boundary', 'Entry event', 'Operator review'] },
    crowd: { title: 'Crowd monitoring area', detail: 'The distribution of people helps an operator assess build-up and congestion.', signals: ['Area occupancy', 'Density context', 'Operator review'] }
};
