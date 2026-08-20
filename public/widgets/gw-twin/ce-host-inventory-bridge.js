/**
 * Connected Enterprise integration adapter for the vendored Gateway Twin.
 *
 * The upstream widget remains a portable static export. CE injects this small
 * same-origin module at runtime so its canonical /api/devices inventory can
 * temporarily own the twin's HostState roster without editing hashed assets.
 * `null` restores the simulator; `[]` is an authoritative empty live roster.
 * It also gives the parent a stable `open-agent` command; browser keyboard
 * events do not cross the iframe boundary on their own.
 */

const MAX_HOSTS = 16
const HOST_KINDS = new Set(['phone', 'laptop', 'tv', 'camera', 'iot', 'console', 'tablet'])
const LAYERS = new Set(['lan1', 'lan2', 'lan3', 'wifi2', 'wifi5', 'wifi6'])

function parentOrigin() {
  if (window.parent === window) return location.origin
  try {
    return document.referrer ? new URL(document.referrer).origin : '*'
  } catch {
    return '*'
  }
}

const PARENT_ORIGIN = parentOrigin()

function post(type, payload) {
  window.parent.postMessage({ source: 'gw-twin', type, payload }, PARENT_ORIGIN)
}

function finiteRate(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1_000_000_000_000, value))
    : 0
}

function finiteRssi(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-120, Math.min(0, value))
    : null
}

function visualKind(kind, domain) {
  const validKind = HOST_KINDS.has(kind) ? kind : 'iot'
  // The current exported twin derives color/group from kind. Preserve the
  // explicit CE classification even when an operator overrides that default.
  if (domain === 'OT') return validKind === 'camera' ? 'camera' : 'iot'
  if (domain === 'IT' && (validKind === 'camera' || validKind === 'iot')) return 'laptop'
  return validKind
}

function normalizeHosts(value) {
  if (!Array.isArray(value)) return undefined
  const seen = new Set()
  const hosts = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue
    const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 128) : ''
    const name = typeof candidate.name === 'string' ? candidate.name.trim().slice(0, 160) : ''
    if (!id || !name || seen.has(id)) continue
    const domain = candidate.domain === 'OT' ? 'OT' : candidate.domain === 'IT' ? 'IT' : undefined
    if (!domain) continue
    seen.add(id)
    const index = hosts.length
    hosts.push({
      id,
      path: typeof candidate.path === 'string' && candidate.path.trim()
        ? candidate.path.trim().slice(0, 160)
        : `Device.Hosts.Host.${index + 1}.`,
      name,
      kind: visualKind(candidate.kind, domain),
      domain,
      layer1: LAYERS.has(candidate.layer1) ? candidate.layer1 : 'wifi5',
      rssiDbm: finiteRssi(candidate.rssiDbm),
      rxBps: finiteRate(candidate.rxBps),
      txBps: finiteRate(candidate.txBps),
      active: candidate.active === true,
    })
    if (hosts.length === MAX_HOSTS) break
  }
  return hosts
}

async function install() {
  const entryScript = [...document.querySelectorAll('script[type="module"][src]')]
    .find((script) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(script.src))
  if (!entryScript) throw new Error('Gateway Twin entry module was not found')

  const entry = await import(entryScript.src)
  const twinStore = Object.values(entry).find((candidate) => {
    if (!candidate || typeof candidate !== 'function') return false
    if (typeof candidate.getState !== 'function' || typeof candidate.setState !== 'function') return false
    const state = candidate.getState()
    return Array.isArray(state?.hosts) && typeof state?.setHosts === 'function'
  })
  if (!twinStore) throw new Error('Gateway Twin host store was not found')

  const originalSetHosts = twinStore.getState().setHosts
  let externalHosts = null
  let externalActive = false

  twinStore.setState({
    setHosts: (simulatedHosts) => originalSetHosts(externalActive ? externalHosts : simulatedHosts),
  })

  const onMessage = (event) => {
    if (event.source !== window.parent) return
    if (PARENT_ORIGIN !== '*' && event.origin !== PARENT_ORIGIN) return
    const message = event.data
    if (!message || typeof message !== 'object' || message.target !== 'gw-twin') return
    if (message.type === 'open-agent') {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }))
      return
    }
    if (message.type !== 'set-hosts') return

    const requested = message.payload?.hosts
    if (requested === null) {
      externalActive = false
      externalHosts = null
      return
    }
    const normalized = normalizeHosts(requested)
    if (normalized === undefined) return
    externalActive = true
    externalHosts = normalized
    originalSetHosts(externalHosts)
  }

  window.addEventListener('message', onMessage)
  post('host-bridge-ready', {
    version: 2,
    maxHosts: MAX_HOSTS,
    capabilities: ['set-hosts', 'open-agent'],
  })
}

install().catch(() => {
  post('host-bridge-error', {
    message: 'The live IT/OT device roster could not attach to this Gateway Twin build.',
  })
})
