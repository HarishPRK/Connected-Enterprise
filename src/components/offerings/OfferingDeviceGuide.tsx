import { useEffect, useRef, type RefObject } from 'react';
import { sampleRouting } from './OfferingRoutingStory';

const DEVICES = [
  { id: 'auto-wifi', protocol: 'Wi-Fi · Matter', name: 'Promotional display plug', color: '#83c4dd' },
  { id: 'auto-thread', protocol: 'Thread · Matter', name: 'Desk lamp plug', color: '#9dd9bb' },
  { id: 'auto-shelly', protocol: 'Wi-Fi · MQTT', name: 'Shelly Plus 1PM · sign circuit', color: '#efba7c' },
  { id: 'auto-presence', protocol: 'Zigbee', name: 'Presence sensor', color: '#cfb8e3' },
  { id: 'auto-controller', protocol: 'Ethernet · IP', name: 'Edge orchestration controller', color: '#b9d0cb' },
];

export function OfferingDeviceGuide({ onSelect }: { onSelect: (id: string) => void }) {
  return <div className="enterprise-device-guide" aria-label="Devices and their protocols">
    <div><strong>One routine. Different protocols.</strong><span>Select a device to inspect its role.</span></div>
    <ul>{DEVICES.map(device => <li key={device.id}><button type="button" onClick={() => onSelect(device.id)}>
      <i style={{ backgroundColor: device.color }} aria-hidden="true" /><span><strong>{device.protocol}</strong><span>{device.name}</span></span>
    </button></li>)}</ul>
    <p>Thread uses a border router. Zigbee presence reaches the controller through its bridge. Shelly is a device brand; this sign relay communicates over Wi-Fi using MQTT.</p>
  </div>;
}

/** Mirrors the physical screen at a readable size, including on phones. */
export function OfferingRoutingReadout({ timeRef, variant, revision, running }: { timeRef: RefObject<number>; variant: string; revision: number; running: boolean }) {
  const title = useRef<HTMLSpanElement>(null), route = useRef<HTMLSpanElement>(null), evidence = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      const state = sampleRouting(timeRef.current, variant);
      const client = state.clients.find(item => item.id === state.selectedClientId)!;
      const current = state.tunnels.find(item => item.id === client.illustratedRoute)!;
      const target = state.tunnels.find(item => item.id === client.desiredRoute)!;
      if (title.current) title.current.textContent = `${client.label} · ${client.app}`;
      if (route.current) route.current.textContent = `Shown route: ${current.id} · ${current.rtt.toFixed(1)} ms  →  Selected: ${target.id} · ${target.rtt.toFixed(1)} ms`;
      const publication = state.brokerAccepted ? 'Published to broker' : state.publishRequested ? 'Publishing assignment' : 'Assignment not published';
      if (evidence.current) evidence.current.textContent = `${publication} · ${state.evidenceLabel} · Illustrative RTT`;
    };
    update();
    if (!running) return;
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [timeRef, variant, revision, running]);
  return <div className="enterprise-routing-readout" aria-label="Application steering screen details"><span ref={title}/><span ref={route}/><span ref={evidence}/></div>;
}
