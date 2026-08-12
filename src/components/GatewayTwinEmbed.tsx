/**
 * GatewayTwinEmbed — drop-in React wrapper for the GW Operational Twin widget.
 *
 * Zero dependencies beyond React (18 or 19). Renders the widget in an iframe
 * and speaks its postMessage protocol (see twin-manifest.json).
 *
 * Host-app setup: copy the widget's `app/` folder to
 * `public/widgets/gw-twin/` (or pass a custom `src`).
 *
 * Usage:
 *   const twin = useRef<GatewayTwinHandle>(null)
 *   <GatewayTwinEmbed ref={twin} scenario="overheat" nohud
 *                     onTwinEvent={(e) => console.log(e.severity, e.text)} />
 *   twin.current?.setScenario('outage')
 */
import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef,
  type CSSProperties,
} from 'react'

export type TwinScenario =
  | 'normal' | 'boot' | 'fwupdate' | 'overheat' | 'outage' | 'cellular' | 'voip'

export interface TwinEvent { t: number; severity: string; text: string; src: string }

export interface TwinLiveState {
  enabled: boolean
  connection: 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error'
  receivedAt: number | null
  endpoint: string | null
  error: string | null
}

export interface TwinState {
  scenario: TwinScenario
  mode: 'solid' | 'xray'
  explode: number
  led: Record<string, unknown>
  health: { cpuPct: number; memPct: number; uptimeSec: number }
  temps: Array<{ id: string; name: string; valueC: number; highAlarmC: number }>
  optical: { rxDbm: number; txDbm: number; alarm: boolean }
  ports: Array<{ id: string; label: string; link: boolean; speedMbps: number; rxBps: number; txBps: number }>
  live: TwinLiveState
}

export interface GatewayTwinHandle {
  /** low-level escape hatch */
  send: (type: string, payload?: unknown) => void
  setScenario: (scenario: TwinScenario) => void
  setExplode: (value: number) => void
  setMode: (mode: 'solid' | 'xray') => void
  setOverlays: (o: { rings?: boolean; hosts?: boolean; flow?: boolean; atmos?: boolean }) => void
  focusPart: (id: string | null) => void
  requestState: () => void
}

export interface GatewayTwinEmbedProps {
  /** where the widget's app/ folder is served from */
  src?: string
  /** initial state (URL-driven; later changes go through the ref handle) */
  scenario?: TwinScenario
  explode?: number
  xray?: boolean
  rings?: boolean
  hosts?: boolean
  flow?: boolean
  still?: boolean
  /** Enable the live AWS IoT field overlay; false keeps the simulator baseline. */
  live?: boolean
  /** hide the twin's own HUD — recommended when embedding as a tile */
  nohud?: boolean
  /** skip GPU-heavy floor reflection (software GL / low-power hosts) */
  lite?: boolean
  title?: string
  className?: string
  style?: CSSProperties
  onReady?: (info: { scenarios: Array<{ id: TwinScenario; label: string; hint: string }>; parts: Array<{ id: string; label: string }> }) => void
  onState?: (state: TwinState) => void
  onTwinEvent?: (event: TwinEvent) => void
}

const DEFAULT_SRC = '/widgets/gw-twin/app/index.html'

export const GatewayTwinEmbed = forwardRef<GatewayTwinHandle, GatewayTwinEmbedProps>(
  function GatewayTwinEmbed(props, ref) {
    const {
      src = DEFAULT_SRC, scenario, explode, xray, rings, hosts, flow, still, live,
      nohud, lite, title = 'GW Operational Twin', className, style,
      onReady, onState, onTwinEvent,
    } = props
    const iframeRef = useRef<HTMLIFrameElement>(null)
    const callbacks = useRef({ onReady, onState, onTwinEvent })
    callbacks.current = { onReady, onState, onTwinEvent }

    // initial state travels in the URL; runtime changes go over postMessage
    const url = useMemo(() => {
      const q = new URLSearchParams({ embed: '1' })
      if (scenario) q.set('scenario', scenario)
      if (explode !== undefined) q.set('explode', String(explode))
      if (xray) q.set('mode', 'xray')
      if (rings) q.set('rings', '1')
      if (hosts) q.set('hosts', '1')
      if (flow === false) q.set('flow', '0')
      if (still) q.set('still', '1')
      if (live === false) q.set('live', '0')
      if (nohud) q.set('nohud', '1')
      if (lite) q.set('lite', '1')
      return `${src}?${q}`
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, live]) // runtime view changes are handled via the ref API

    const widgetOrigin = useMemo(
      () => new URL(src, window.location.href).origin,
      [src],
    )

    useEffect(() => {
      const onMessage = (e: MessageEvent) => {
        if (e.source !== iframeRef.current?.contentWindow) return
        if (e.origin !== widgetOrigin) return
        const m = e.data
        if (!m || typeof m !== 'object' || m.source !== 'gw-twin') return
        if (m.type === 'ready') callbacks.current.onReady?.(m.payload)
        else if (m.type === 'state') callbacks.current.onState?.(m.payload)
        else if (m.type === 'event') callbacks.current.onTwinEvent?.(m.payload)
      }
      window.addEventListener('message', onMessage)
      return () => window.removeEventListener('message', onMessage)
    }, [widgetOrigin])

    useImperativeHandle(ref, () => {
      const send = (type: string, payload?: unknown) =>
        iframeRef.current?.contentWindow?.postMessage(
          { target: 'gw-twin', type, payload },
          widgetOrigin,
        )
      return {
        send,
        setScenario: (s) => send('set-scenario', { scenario: s }),
        setExplode: (value) => send('set-explode', { value }),
        setMode: (mode) => send('set-mode', { mode }),
        setOverlays: (o) => send('set-overlays', o),
        focusPart: (id) => send('focus-part', { id }),
        requestState: () => send('get-state'),
      }
    }, [widgetOrigin])

    return (
      <iframe
        ref={iframeRef}
        src={url}
        title={title}
        className={className}
        style={{ border: 0, width: '100%', height: '100%', display: 'block', background: '#060709', ...style }}
        allow="fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    )
  },
)

export default GatewayTwinEmbed
