import { useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import GatewayTwinEmbed, {
  type GatewayTwinHandle,
  type TwinScenario,
} from '../components/GatewayTwinEmbed';

/* ─────────── Gateway Digital Twin
 * Embeds the GW Operational Twin widget (public/widgets/gw-twin — built from
 * the GW-Operational-Twin repo via `npm run build:embed`). The widget is
 * fully self-contained: in-browser TR-181 simulator, no backend. The scenario
 * picker drives it over its postMessage API; see the widget's EMBED.md. */

const SCENARIOS: Array<{ id: TwinScenario; label: string }> = [
  { id: 'normal', label: 'Normal' },
  { id: 'boot', label: 'Boot sequence' },
  { id: 'fwupdate', label: 'Firmware update' },
  { id: 'overheat', label: 'Overheat' },
  { id: 'outage', label: 'Fiber outage' },
  { id: 'cellular', label: 'Cellular failover' },
  { id: 'voip', label: 'VoIP problem' },
];

export function GatewayTwinPage() {
  const twin = useRef<GatewayTwinHandle>(null);
  const [scenario, setScenario] = useState<TwinScenario>('normal');

  return (
    <>
      <PageHeader
        title="Gateway Digital Twin"
        subtitle="Photoreal 3D operational twin of the BGW620-700 fiber gateway — live TR-181 telemetry, LED mirroring, thermal x-ray, exploded view"
        right={
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--text-dim)' }}>Scenario</span>
            <select
              value={scenario}
              onChange={(e) => {
                const s = e.target.value as TwinScenario;
                setScenario(s);
                twin.current?.setScenario(s);
              }}
            >
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
        }
      />
      <div
        style={{
          height: 'calc(100vh - 200px)',
          minHeight: 480,
          borderRadius: 12,
          overflow: 'hidden',
          border: '1px solid var(--border, rgba(128,128,128,0.25))',
        }}
      >
        <GatewayTwinEmbed ref={twin} />
      </div>
    </>
  );
}
