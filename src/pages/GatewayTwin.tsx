import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import GatewayTwinEmbed, {
  type GatewayTwinHandle,
  type TwinLiveState,
  type TwinScenario,
  type TwinState,
} from '../components/GatewayTwinEmbed';
import {
  BRANCH_TO_DEVICE_TOPIC,
  BRANCH_TO_IPSEC_SOURCE,
  branches,
} from '../data/mock';
import { gatewayTwinHostRoster } from '../ui/gatewayTwinHosts';
import { useDevices } from '../ui/useDevices';
import { useToast } from '../ui/Toast';

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
  const pageRef = useRef<HTMLDivElement>(null);
  const twin = useRef<GatewayTwinHandle>(null);
  const fullscreenErrorAt = useRef(0);
  const [scenario, setScenario] = useState<TwinScenario>('normal');
  const [twinState, setTwinState] = useState<TwinState>();
  const [ready, setReady] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const { push } = useToast();
  const deviceInventory = useDevices();
  const branch = branches.find((item) => item.id === branchId) ?? branches[0];
  // The current OSPv2 DeviceInfo topics belong to the prpl gateway family.
  // Other branches intentionally render the same complete simulator without
  // mislabelling that gateway's measurements as their own.
  const liveEnabled = BRANCH_TO_IPSEC_SOURCE[branchId] === 'prpl';
  const deviceTopic = BRANCH_TO_DEVICE_TOPIC[branchId];
  const hostRoster = useMemo(
    () => gatewayTwinHostRoster(deviceInventory.devices, {
      locationSource: BRANCH_TO_IPSEC_SOURCE[branchId],
      inventoryTopic: deviceTopic,
      inventoryTopicsSeen: deviceInventory.inventoryTopicsSeen,
    }),
    [
      branchId,
      deviceInventory.devices,
      deviceInventory.inventoryTopicsSeen,
      deviceTopic,
    ],
  );
  const status = useMemo(
    () => sourceStatus(liveEnabled, twinState?.live),
    [liveEnabled, twinState?.live],
  );

  const reportFullscreenError = useCallback((detail?: string) => {
    const now = Date.now();
    if (now - fullscreenErrorAt.current < 400) return;
    fullscreenErrorAt.current = now;
    push({
      kind: 'error',
      title: 'Full-screen action failed',
      detail: detail ?? 'Allow full-screen access in the browser, then try again.',
    });
  }, [push]);

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(document.fullscreenElement === pageRef.current);
    };
    const onFullscreenError = () => reportFullscreenError();

    setFullscreenSupported(Boolean(
      document.fullscreenEnabled && pageRef.current?.requestFullscreen,
    ));
    syncFullscreenState();
    document.addEventListener('fullscreenchange', syncFullscreenState);
    document.addEventListener('fullscreenerror', onFullscreenError);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenState);
      document.removeEventListener('fullscreenerror', onFullscreenError);
    };
  }, [reportFullscreenError]);

  useEffect(() => {
    if (!ready) return;
    twin.current?.setHostRoster(liveEnabled ? hostRoster : null);
    twin.current?.setOverlays({ hosts: liveEnabled });
  }, [hostRoster, liveEnabled, ready]);

  const toggleFullscreen = async () => {
    const page = pageRef.current;
    if (!page || !fullscreenSupported) {
      reportFullscreenError('This browser does not support full-screen mode.');
      return;
    }

    try {
      if (document.fullscreenElement === page) {
        await document.exitFullscreen();
      } else if (document.fullscreenElement) {
        reportFullscreenError('Exit the current full-screen view, then try again.');
      } else {
        await page.requestFullscreen();
      }
    } catch (error) {
      reportFullscreenError(
        error instanceof Error ? error.message : undefined,
      );
    }
  };

  return (
    <div
      ref={pageRef}
      className={`gateway-twin-page${isFullscreen ? ' is-fullscreen' : ''}`}
    >
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
            <button
              type="button"
              className="gateway-twin-fullscreen-button"
              disabled={!fullscreenSupported}
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit gateway twin full screen' : 'Open gateway twin full screen'}
              aria-pressed={isFullscreen}
              title={fullscreenSupported
                ? isFullscreen ? 'Exit full screen (Esc)' : 'Open twin in full screen'
                : 'Full-screen mode is unavailable in this browser'}
            >
              {isFullscreen
                ? <Minimize2 size={16} aria-hidden="true" />
                : <Maximize2 size={16} aria-hidden="true" />}
              <span>{isFullscreen ? 'Exit full screen' : 'Full screen'}</span>
            </button>
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
          hosts={liveEnabled}
          hostBridgeSrc={liveEnabled
            ? '/widgets/gw-twin/ce-host-inventory-bridge.js'
            : undefined}
          onReady={() => setReady(true)}
          onState={(state) => {
            setTwinState(state);
            setScenario(state.scenario);
          }}
          onHostBridgeError={(error) => push({
            kind: 'error',
            title: 'IT/OT roster unavailable',
            detail: error.message,
          })}
        />
      </div>
    </div>
  );
}
