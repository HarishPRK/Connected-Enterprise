import { useCallback, useEffect, useRef, useState } from 'react'
import { commandSchema, serverMessageSchema, type Telemetry } from '../shared/telemetry'

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'stale'
type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
const STALE_AFTER_MS = 5000

/** Keep reconnect duplicates out of charts; sensor freshness is distinct from socket activity. */
export function classifyTelemetry(previous: Telemetry | null, next: Telemetry, now = Date.now()) {
  const timestamp = Date.parse(next.timestamp)
  const changedDevice = !!previous && (previous.deviceId !== next.deviceId || previous.source !== next.source)
  const sameStream = !!previous && !changedDevice
  const future = !Number.isFinite(timestamp) || timestamp > now + 10_000
  const earlier = sameStream && (timestamp < Date.parse(previous.timestamp) || (next.timestamp === previous.timestamp && next.sequence < previous.sequence))
  const duplicate = sameStream && next.sequence === previous.sequence && next.timestamp === previous.timestamp
  return {
    disposition: future || earlier ? 'ignore' as const : duplicate ? 'duplicate' as const : 'append' as const,
    fresh: !future && now - timestamp <= STALE_AFTER_MS,
    // A process/device restart starts a new chart. A simulator reset retains increasing sequences.
    resetHistory: changedDevice || (sameStream && next.sequence < previous.sequence && timestamp > Date.parse(previous.timestamp)),
    sensorTime: Math.min(now, timestamp),
    clockError: future,
  }
}

/** One validated 1 Hz stream; the renderer animates independently of telemetry. */
export function useCoolerTelemetry() {
  const [data, setData] = useState<Telemetry | null>(null)
  const [history, setHistory] = useState<Telemetry[]>([])
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const socket = useRef<WebSocket | null>(null)
  const latest = useRef<Telemetry | null>(null)
  const pending = useRef(new Map<string, Pending>())
  const lastReceived = useRef(0)
  const mounted = useRef(false)

  useEffect(() => {
    let disposed = false
    let retry = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let connectionTimer: ReturnType<typeof setTimeout> | undefined
    let ownedSocket: WebSocket | null = null
    let openedAt = 0
    mounted.current = true
    setPendingCount(0)

    const rejectPending = () => {
      pending.current.forEach(item => { clearTimeout(item.timer); item.reject(new Error('Connection lost. Command was not confirmed.')) })
      pending.current.clear()
      if (!disposed) setPendingCount(0)
    }
    const scheduleReconnect = () => {
      if (disposed) return
      clearTimeout(timer)
      setConnection('reconnecting')
      timer = setTimeout(connect, Math.min(1000 * 2 ** Math.min(retry++, 4), 15000) + Math.random() * 300)
    }
    const connect = () => {
      if (disposed) return
      setConnection(retry ? 'reconnecting' : 'connecting')
      lastReceived.current = 0
      openedAt = 0
      const url = import.meta.env.VITE_WS_URL || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
      let ws: WebSocket
      try { ws = new WebSocket(url) }
      catch { setError('The telemetry WebSocket address is invalid or unavailable.'); scheduleReconnect(); return }
      ownedSocket = ws
      socket.current = ws
      const active = () => !disposed && socket.current === ws
      connectionTimer = setTimeout(() => {
        if (active() && ws.readyState === WebSocket.CONNECTING) ws.close()
      }, 10_000)
      ws.onopen = () => {
        if (!active()) return
        clearTimeout(connectionTimer)
        openedAt = Date.now()
        // An open socket alone does not make stale or missing device readings live.
      }
      ws.onmessage = event => {
        if (!active()) return
        let payload: unknown
        try {
          if (typeof event.data !== 'string') throw new Error('Expected JSON text')
          payload = JSON.parse(event.data)
        } catch { setError('Unable to decode the telemetry message.'); return }
        const parsed = serverMessageSchema.safeParse(payload)
        if (!parsed.success) { setError('The telemetry source sent an invalid sensor packet or acknowledgement.'); return }
        const message = parsed.data
        if (message.type === 'telemetry') {
          const next = message.data
          const decision = classifyTelemetry(latest.current, next)
          if (decision.disposition === 'ignore') {
            if (decision.clockError) setError('The sensor timestamp is invalid or its clock is over 10 seconds ahead.')
            return
          }
          retry = 0
          lastReceived.current = decision.sensorTime
          setConnection(decision.fresh ? 'connected' : 'stale')
          setError(null)
          if (decision.disposition === 'duplicate') return
          latest.current = next
          setData(next)
          setHistory(previous => decision.resetHistory ? [next] : [...previous, next].slice(-300))
        } else {
          const item = pending.current.get(message.id)
          if (!item) return
          clearTimeout(item.timer)
          pending.current.delete(message.id)
          setPendingCount(pending.current.size)
          if (message.ok) item.resolve()
          else item.reject(new Error(message.error ?? 'The device rejected this command.'))
        }
      }
      ws.onerror = () => {
        if (active() && ws.readyState < WebSocket.CLOSING) ws.close()
      }
      ws.onclose = () => {
        if (!active()) return
        clearTimeout(connectionTimer)
        socket.current = null
        lastReceived.current = 0
        rejectPending()
        scheduleReconnect()
      }
    }
    // Deferring one task avoids aborting an opening socket during StrictMode's effect probe.
    timer = setTimeout(connect, 0)
    const watchdog = setInterval(() => {
      if (socket.current?.readyState !== WebSocket.OPEN) return
      const baseline = lastReceived.current || openedAt
      if (baseline && Date.now() - baseline > STALE_AFTER_MS) setConnection('stale')
    }, 1000)
    return () => {
      disposed = true
      mounted.current = false
      clearTimeout(timer)
      clearTimeout(connectionTimer)
      clearInterval(watchdog)
      if (ownedSocket) {
        ownedSocket.onopen = null
        ownedSocket.onmessage = null
        ownedSocket.onerror = null
        ownedSocket.onclose = null
        if (ownedSocket.readyState < WebSocket.CLOSING) ownedSocket.close()
        if (socket.current === ownedSocket) socket.current = null
      }
      lastReceived.current = 0
      rejectPending()
    }
  }, [])

  const command = useCallback((name: string, value?: unknown): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ws = socket.current
      if (!mounted.current || !latest.current || !ws || ws.readyState !== WebSocket.OPEN || !lastReceived.current || Date.now() - lastReceived.current > STALE_AFTER_MS) {
        reject(new Error('Connect to fresh device telemetry before changing the cooler.'))
        return
      }
      if (pending.current.size >= 8) { reject(new Error('Wait for the current device commands to complete.')); return }
      const id = crypto.randomUUID()
      const parsed = commandSchema.safeParse({ type: 'command', id, command: name, ...(value !== undefined ? { value } : {}) })
      if (!parsed.success) { reject(new Error('The requested command or value is outside the allowed range.')); return }
      const timer = setTimeout(() => {
        pending.current.delete(id)
        if (mounted.current) setPendingCount(pending.current.size)
        reject(new Error('No device confirmation received. Check the current state before retrying.'))
      }, 10_000)
      pending.current.set(id, { resolve, reject, timer })
      setPendingCount(pending.current.size)
      try { ws.send(JSON.stringify(parsed.data)) }
      catch {
        clearTimeout(timer)
        pending.current.delete(id)
        if (mounted.current) setPendingCount(pending.current.size)
        reject(new Error('Connection lost before the command could be sent.'))
      }
    })
  }, [])
  const clearError = useCallback(() => setError(null), [])
  return { data, history, connection, command, pending: pendingCount > 0, error, clearError, latest }
}
