import { useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import GatewayTwinEmbed, {
  type GatewayTwinHandle,
  type TwinLiveState,
  type TwinScenario,
  type TwinState,
} from '../components/GatewayTwinEmbed';
import { BRANCH_TO_IPSEC_SOURCE, branches } from '../data/mock';

/* ─────────── Gateway Digital Twin
 * Embeds the GW Operational Twin widget (public/widgets/gw-twin — built from
 * the GW-Operational-Twin repo via `npm run build:embed`). The widget keeps a
 * complete in-browser TR-181 simulator as a per-field fallback while
 * Connected Enterprise's AWS IoT session supplies the live OSPv2 overlay. */

const SCENARIOS: Array<{ id: TwinScenario; label: string }> = [
  { id: 'normal', label: 'Normal' },
  { id: 'boot', label: 'Boot sequence' },
  { id: 'fwupdate', label: 'Firmware update' },
  { id: 'overheat', label: 'Overheat' },
  { id: 'outage', label: 'Fiber outage' },
  { id: 'cellular', label: 'Cellular failover' },
  { id: 'voip', label: 'VoIP problem' },
];

interface GatewayTwinPageProps {
  branchId: string;
}

const LIVE_STALE_MS = 150_000;

function sourceStatus(
  liveEnabled: boolean,
  live: TwinLiveState | undefined,
): { label: string; detail: string; tone: string } {
  if (!liveEnabled) {
    return {
      label: 'Simulator',
      detail: 'No OSPv2 feed mapped to this branch',
      tone: 'sim',
    };
  }
  if (!live || live.connection === 'disabled' || live.connection === 'connecting') {
    return { label: 'Connecting', detail: 'Opening the AWS IoT stream', tone: 'pending' };
  }
  if (live.connection === 'reconnecting') {
    return { label: 'Reconnecting', detail: 'Simulator remains active', tone: 'warn' };
  }
  if (live.connection === 'offline' || live.connection === 'error') {
    return { label: 'Feed offline', detail: 'Showing the simulator fallback', tone: 'error' };
  }
  if (live.receivedAt === null) {
    return { label: 'Awaiting data', detail: 'IoT connected; waiting for a sample', tone: 'pending' };
  }
  if (Date.now() - live.receivedAt > LIVE_STALE_MS) {
    return { label: 'Live data stale', detail: 'Last sample is older than 150 seconds', tone: 'warn' };
  }
  return { label: 'Live AWS IoT', detail: 'Device fields are updating', tone: 'live' };
}

export function GatewayTwinPage({ branchId }: GatewayTwinPageProps) {
  const twin = useRef<GatewayTwinHandle>(null);
  const [scenario, setScenario] = useState<TwinScenario>('normal');
  const [twinState, setTwinState] = useState<TwinState>();
  const [ready, setReady] = useState(false);
  const branch = branches.find((item) => item.id === branchId) ?? branches[0];
  // The current OSPv2 DeviceInfo topics belong to the prpl gateway family.
  // Other branches intentionally render the same complete simulator without
  // mislabelling that gateway's measurements as their own.
  const liveEnabled = BRANCH_TO_IPSEC_SOURCE[branchId] === 'prpl';
  const status = useMemo(
    () => sourceStatus(liveEnabled, twinState?.live),
    [liveEnabled, twinState?.live],
  );

  return (
    <div className="gateway-twin-page">
      <PageHeader
        title="GW Operational Twin"
        subtitle="Gemtek OSPv2 edge gateway · XGS-PON · Wi-Fi 7 · prplOS — live fields overlay a complete TR-181 simulator fallback"
        right={
          <div className="gateway-twin-toolbar">
            <div
              className="gateway-twin-source"
              data-tone={status.tone}
              role="status"
              title={`${branch.name}: ${status.detail}`}
            >
              <span className="gateway-twin-source-dot" aria-hidden="true" />
              <span>
                <strong>{status.label}</strong>
                <small>{branch.name}</small>
              </span>
            </div>
            <label className="gateway-twin-scenario">
              <span>Scenario</span>
              <select
                value={scenario}
                disabled={!ready}
                onChange={(e) => {
                  const next = e.target.value as TwinScenario;
                  setScenario(next);
                  twin.current?.setScenario(next);
                }}
                aria-label="Gateway twin scenario"
              >
                {SCENARIOS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
          </div>
        }
      />
      <div className="gateway-twin-frame" data-source-tone={status.tone}>
        {!ready && (
          <div className="gateway-twin-loading" role="status">
            <span className="gateway-twin-loading-mark" aria-hidden="true" />
            Preparing the operational twin
          </div>
        )}
        <GatewayTwinEmbed
          key={`${branchId}:${liveEnabled ? 'live' : 'sim'}`}
          ref={twin}
          scenario={scenario}
          live={liveEnabled}
          onReady={() => setReady(true)}
          onState={(state) => {
            setTwinState(state);
            setScenario(state.scenario);
          }}
        />
      </div>
    </div>
  );
}
