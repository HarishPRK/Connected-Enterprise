import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, ArrowDownToLine, ArrowRight, Box, Check, ChevronDown, ChevronRight, CircleHelp, Cpu, DoorClosed, DoorOpen, Droplets, Expand, Gauge, Layers3, MapPin, MoreHorizontal, Package, Radio, RefreshCw, Settings2, ShieldCheck, SlidersHorizontal, Snowflake, Thermometer, Wifi, Wind, X, Zap } from 'lucide-react'
import { useCoolerTelemetry } from './useCoolerTelemetry'
import type { ComponentName, ViewMode } from './CoolerScene'
import type { Telemetry } from '../shared/telemetry'

const CoolerScene = lazy(() => import('./CoolerScene'))
type Tab = 'overview' | 'diagnostics' | 'inventory'
type Modal = 'settings' | 'about' | 'connection' | null
const fmt = (n: number | undefined, digits = 1) => n === undefined ? '—' : n.toFixed(digits)
const average = (d: Telemetry) => (d.temperature.top + d.temperature.middle + d.temperature.bottom) / 3

function CoolerMark({ small = false }: { small?: boolean }) {
  return <span className={`cooler-mark ${small ? 'small' : ''}`}><svg viewBox="0 0 24 30" fill="none" aria-hidden="true"><rect x="5" y="2" width="14" height="26" rx="2" stroke="currentColor" strokeWidth="1.7"/><path d="M8 6h8v15H8zM8 25h8M8 11h8M8 16h8" stroke="currentColor" strokeWidth="1.4"/><path d="M14 12v3" stroke="currentColor" strokeWidth="1.3"/></svg></span>
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog className="app-dialog" ref={ref} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }} aria-labelledby="dialog-title"><div className="dialog-header"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</dialog>
}

function TemperatureChart({ history, range }: { history: Telemetry[]; range: number }) {
  const end = history.length ? Date.parse(history[history.length - 1].timestamp) : Date.now()
  const points = history.filter(d => Date.parse(d.timestamp) >= end - range * 1000)
  const values = points.flatMap(p => [p.temperature.top, p.temperature.middle, p.temperature.bottom])
  const min = Math.min(1, ...values.map(v => Math.floor(v - 0.5)))
  const max = Math.max(7, ...values.map(v => Math.ceil(v + 0.5)))
  const x = (timestamp: string) => 42 + (Date.parse(timestamp) - (end - range * 1000)) / (range * 1000) * 710
  const y = (v: number) => 132 - (v - min) / (max - min) * 110
  const path = (key: 'top' | 'middle' | 'bottom') => points.map((p, i) => `${i ? 'L' : 'M'}${x(p.timestamp).toFixed(1)},${y(p.temperature[key]).toFixed(1)}`).join(' ')
  return <div className="temperature-graph">
    <svg viewBox="0 0 770 170" role="img" aria-label={`Temperature history over the last ${range} seconds. ${points.length} real samples received.`}>
      <defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef495a" stopOpacity="0.14"/><stop offset="100%" stopColor="#ef495a" stopOpacity="0"/></linearGradient></defs>
      {[0, 1, 2, 3].map(i => { const value = min + (max - min) / 3 * i; return <g key={i}><line x1="42" x2="752" y1={y(value)} y2={y(value)} stroke="#34373b" strokeDasharray="3 5"/><text x="0" y={y(value) + 4} fill="#878b91" fontSize="11">{value.toFixed(0)}°C</text></g> })}
      <rect x="42" y={y(5)} width="710" height={y(2) - y(5)} fill="#49ae8d" opacity="0.045"/>
      {points.length > 1 && <>
        <path d={`${path('middle')} L${x(points[points.length - 1].timestamp)},132 L${x(points[0].timestamp)},132 Z`} fill="url(#chart-fill)"/>
        <path d={path('top')} stroke="#eaaa71" strokeWidth="1.6" fill="none"/>
        <path d={path('bottom')} stroke="#6eafd0" strokeWidth="1.6" fill="none"/>
        <path d={path('middle')} stroke="#f25c6d" strokeWidth="2.2" fill="none"/>
        <circle cx={x(points[points.length - 1].timestamp)} cy={y(points[points.length - 1].temperature.middle)} r="3.5" fill="#f25c6d"/>
      </>}
      {[0, 1, 2, 3, 4].map(i => <text key={i} x={42 + i * 177.5} y="160" textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} fill="#878b91" fontSize="11">{i === 4 ? 'Now' : `−${Math.round(range - range * i / 4)}s`}</text>)}
    </svg>
    {points.length < 2 && <div className="chart-wait">Waiting for temperature samples…</div>}
  </div>
}

function Inventory({ data, enabled, onSlot, onRestock, expanded = false }: { data: Telemetry | null; enabled: boolean; onSlot: (row: number, col: number, filled: boolean) => void; onRestock: () => void; expanded?: boolean }) {
  const stock = data?.stock
  const count = stock?.flat().filter(Boolean).length ?? 0
  return <section className={`panel inventory-panel ${expanded ? 'inventory-expanded' : ''}`}>
    <div className="panel-heading"><h2><Package size={16}/>Shelf inventory</h2><span className="muted count-label"><b>{data ? count : '—'}</b> / 40 slots</span></div>
    <div className="stock-matrix">{[4, 3, 2, 1, 0].map(r => <div className="stock-row" key={r}><span>S{5 - r}</span>{Array.from({ length: 8 }, (_, c) => <button key={c} disabled={!enabled} className={`stock-slot ${stock?.[r]?.[c] ? 'filled' : ''}`} aria-label={`Shelf ${5 - r}, slot ${c + 1}: ${stock?.[r]?.[c] ? 'filled, click to remove' : 'empty, click to replenish'}`} title={`Shelf ${5 - r} · Slot ${c + 1}`} onClick={() => onSlot(r, c, !stock?.[r]?.[c])}>{expanded && <Package size={17}/>}</button>)}</div>)}</div>
    <div className="inventory-footer"><span><i className="legend-square"/> In stock <i className="legend-square empty"/> Empty</span><button className="text-button" disabled={!enabled || count === 40} onClick={onRestock}>Restock all <ArrowRight size={13}/></button></div>
    {expanded && <p className="panel-note">Select a slot to simulate a purchase or replenishment. The physical bottle disappears or returns in the twin when the service confirms the change.</p>}
  </section>
}

function Diagnostics({ data }: { data: Telemetry | null }) {
  const fields = [
    ['Compressor current', `${fmt(data?.compressor.currentAmps, 2)} A`, data?.source === 'hardware' ? 'Sensor-reported operating current' : 'Synthetic operating current'],
    ['Discharge pressure', `${fmt(data?.compressor.pressureBar)} bar(g)`, data?.source === 'hardware' ? 'Sensor-reported gauge pressure' : 'Gauge pressure · simulated'],
    ['Vibration frequency', `${fmt(data?.compressor.vibrationHz)} Hz`, 'Dominant spectral frequency'],
    ['Compressor duty', `${fmt(data?.compressor.dutyCycle, 0)}%`, 'Observed running share'],
    ['Compressor runtime', `${fmt(data ? data.compressor.runtimeSeconds / 60 : undefined)} min`, 'Equipment runtime counter'],
    ['Energy consumed', `${fmt(data?.energyKwh, 3)} kWh`, 'Integrated over this session'],
  ]
  return <section className="panel diagnostic-panel"><div className="panel-heading"><h2><Activity size={16}/>Compressor diagnostics</h2><span className="tiny-label">SESSION DATA</span></div><div className="diagnostic-grid">{fields.map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</div></section>
}

export default function App() {
  const { data, history, connection, command, pending, error, clearError } = useCoolerTelemetry()
  const [tab, setTab] = useState<Tab>('overview')
  const [view, setView] = useState<ViewMode>('studio')
  const [selected, setSelected] = useState<ComponentName>('overview')
  const [badges, setBadges] = useState(true)
  const [range, setRange] = useState(60)
  const [modal, setModal] = useState<Modal>(null)
  const [setpoint, setSetpoint] = useState(3)
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const snapshotRef = useRef<(() => void) | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isLive = connection === 'connected'
  const enabled = isLive && !!data && !pending && data.source === 'simulator'
  const stockCount = data?.stock.flat().filter(Boolean).length ?? 0
  const currentTemp = data ? average(data) : undefined
  const showNotice = (message: string, isError = false) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    setNotice({ message, error: isError })
    noticeTimer.current = setTimeout(() => setNotice(null), isError ? 8000 : 4000)
  }
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current) }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [])
  const send = async (name: string, value?: unknown, success?: string) => {
    try { await command(name, value); if (success) showNotice(success) }
    catch (err) { showNotice(err instanceof Error ? err.message : 'Unable to send command.', true) }
  }
  const toggleDoor = () => { if (enabled) void send('set-door', !data?.doorOpen, data?.doorOpen ? 'Door closed. The cabinet is recovering.' : 'Door opened. Watch the temperature respond.') }
  const exportData = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), telemetry: data, history }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = `cooler-${data.deviceId}-${Date.now()}.json`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showNotice('Telemetry snapshot and session history exported.')
  }
  const openSettings = () => { setSetpoint(data?.temperature.setpoint ?? 3); setModal('settings') }
  const selectPart = (part: ComponentName) => { setSelected(part); if (part === 'thermostat') openSettings() }
  const componentLabel = { overview: 'System overview', door: 'Glass door assembly', compressor: 'Compressor assembly', shelves: 'Shelf inventory', thermostat: 'Temperature controller' }[selected]

  return <div className="app-shell">
    <aside className="rail"><a className="rail-brand" href="#" aria-label="Cooler Studio home" onClick={e => { e.preventDefault(); setTab('overview') }}><CoolerMark/></a><div className="rail-nav">
      <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')} aria-label="Overview" title="Overview"><Box size={21}/></button>
      <button className={tab === 'diagnostics' ? 'active' : ''} onClick={() => setTab('diagnostics')} aria-label="Diagnostics" title="Diagnostics"><Activity size={21}/></button>
      <button className={tab === 'inventory' ? 'active' : ''} onClick={() => setTab('inventory')} aria-label="Inventory" title="Inventory"><Layers3 size={21}/></button>
    </div><div className="rail-bottom"><button aria-label="Cooler settings" title="Cooler settings" onClick={openSettings}><Settings2 size={20}/></button><button aria-label="About this digital twin" title="About this digital twin" onClick={() => setModal('about')}><CircleHelp size={20}/></button><span className="avatar" title="Local operator">OP</span></div></aside>
    <div className="workspace"><header className="topbar"><div className="wordmark">Cooler<span>Studio</span><span className="product-tag">DIGITAL TWIN</span></div><div className="topbar-right"><button className="connection-button" aria-label="Telemetry connection details" onClick={() => setModal('connection')}><span className={`status-dot ${isLive ? '' : 'offline'}`}/><span>{isLive ? 'Device connected' : connection === 'stale' ? 'Telemetry delayed' : 'Connecting to device'}</span><ChevronDown size={13}/></button><div className="topbar-divider"/><span className="brand-script">Coca-Cola</span></div></header>
    <main>
      <div className="breadcrumb"><span>Asset workspace</span><ChevronRight size={13}/><span>Beverage coolers</span><ChevronRight size={13}/><b>GDM–001</b></div>
      <section className="page-heading"><div><div className="eyebrow">CONNECTED REFRIGERATION</div><h1>Your cooler. In every dimension.</h1><p>A real-time view into the details that keep every drink perfectly chilled.</p></div><button className="secondary-button export-button" disabled={!data} onClick={exportData}><ArrowDownToLine size={16}/>Export data</button></section>
      <div className="device-bar"><div className="device-identity"><CoolerMark small/><div><strong>Single-door merchandiser <span>GDM–001</span></strong><small><MapPin size={12}/> Demo retail location <i/> Imbera G319 style</small></div></div><div className="device-state"><span className="simulation-badge"><Radio size={12}/>{data?.source === 'hardware' ? 'Live hardware' : 'Simulation mode'}</span><span className={`operational ${data?.alarms.length ? 'warning-text' : ''}`}><span className={`status-dot ${!isLive ? 'offline' : ''}`}/>{!data ? 'Awaiting telemetry' : !isLive ? 'Last known state' : data.alarms.length ? `${data.alarms.length} active alert${data.alarms.length > 1 ? 's' : ''}` : 'Operating normally'}</span></div></div>
      <div className="tabs-row"><nav className="tabs" aria-label="Workspace view">{(['overview', 'diagnostics', 'inventory'] as Tab[]).map(t => <button key={t} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined} className={tab === t ? 'active' : ''}>{t[0].toUpperCase() + t.slice(1)}{t === 'inventory' && <span>{data ? stockCount : '—'}</span>}</button>)}</nav><span className="update-cadence"><RefreshCw size={12}/>{isLive ? 'Updating every second' : 'Waiting for connection'}</span></div>
      {!isLive && <div className="connection-banner" role="status"><Wifi size={16}/>{connection === 'stale' ? 'No fresh telemetry for 5 seconds. Values below show the last received state.' : 'Connecting to the telemetry service. Controls become available when the stream is ready.'}</div>}
      {data?.alarms.map(alarm => <div className="alarm-banner" role="status" key={alarm.id}><Activity size={15}/>{alarm.message}</div>)}
      <div className="overview-grid">
        <section className={`panel twin-panel ${expanded ? 'expanded-view' : ''}`}>
          <div className="twin-heading"><div><h2><Box size={16}/>Digital twin</h2><span className="tiny-label">INTERACTIVE 3D VIEW</span></div><div className="twin-actions"><button className={`icon-button ${badges ? 'enabled' : ''}`} title="Toggle sensor labels" aria-label="Toggle sensor labels" aria-pressed={badges} onClick={() => setBadges(v => !v)}><SlidersHorizontal size={16}/></button><button className="icon-button" title={expanded ? 'Exit expanded view' : 'Expand 3D view'} aria-label={expanded ? 'Exit expanded view' : 'Expand 3D view'} onClick={() => setExpanded(v => !v)}>{expanded ? <X size={17}/> : <Expand size={16}/>}</button></div></div>
          <div className="scene-meta"><span className="scene-live"><span className={`status-dot ${isLive ? '' : 'offline'}`}/>{isLive ? 'LIVE TWIN' : 'CONNECTING'}</span><span>GDM–001 <i/> 1 : 1 scale</span></div>
          <div className="view-switch" aria-label="Model visualization"><button className={view === 'studio' ? 'active' : ''} onClick={() => setView('studio')}>Realistic</button><button className={view === 'thermal' ? 'active' : ''} onClick={() => setView('thermal')}>Component map</button></div>
          <Suspense fallback={<div className="scene-loading">Loading 3D studio…</div>}><CoolerScene data={data} selected={selected} onSelect={selectPart} onDoor={toggleDoor} badges={badges} view={view} canControl={enabled} snapshotRef={snapshotRef}/></Suspense>
          <div className="twin-footer"><span><span className="status-dot"/> {data?.doorOpen ? 'Door open · thermal response active' : 'Door closed · insulated cavity'}</span><button className="text-button" onClick={() => { if (snapshotRef.current) { snapshotRef.current(); showNotice('3D image captured.') } else showNotice('Wait for the 3D model to finish loading.', true) }}><ArrowDownToLine size={13}/>Capture view</button></div>
        </section>
        <aside className="telemetry-column">
          <div className="telemetry-heading"><h2>Live telemetry</h2><span className="tiny-label">{data ? new Date(data.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '—'}</span></div>
          <section className="panel temperature-card"><div className="metric-label"><span><Thermometer size={16}/>Cabinet temperature</span><span className="metric-chip">{!data ? 'Awaiting data' : currentTemp! > 5 ? 'Above range' : currentTemp! < 2 ? 'Below range' : data.compressor.running ? 'Cooling active' : 'Within range'}</span></div><div className="temperature-reading">{fmt(currentTemp)}<span>°C</span><div><Snowflake size={13}/><span>Set point <b>{fmt(data?.temperature.setpoint)}°C</b></span></div></div><div className="temperature-scale"><span/><i style={{ left: `${Math.min(98, Math.max(2, (currentTemp ?? 3.2) / 10 * 100))}%` }}/></div><div className="scale-labels"><span>0°C</span><span>Target range 2–5°C</span><span>10°C</span></div><div className="zone-readings">{(['top', 'middle', 'bottom'] as const).map(zone => <div key={zone}><small><i className={`zone-dot ${zone}`}/>{zone[0].toUpperCase() + zone.slice(1)} zone</small><strong>{fmt(data?.temperature[zone])}<span>°C</span></strong></div>)}</div></section>
          <div className="metric-pair"><section className="panel mini-metric"><span><Droplets size={16}/>Humidity</span><strong>{fmt(data?.humidity, 0)}<em>%</em></strong><small>Internal relative humidity</small></section><section className="panel mini-metric"><span><Zap size={16}/>Power draw</span><strong>{fmt(data?.powerWatts, 0)}<em>W</em></strong><small>{data?.compressor.running ? 'Compressor running' : data ? 'Compressor idle' : 'Awaiting telemetry'}</small></section></div>
          <section className="panel component-panel"><div className="panel-heading"><h2><Cpu size={16}/>{componentLabel}</h2><button className="icon-button" aria-label="Open component diagnostics" onClick={() => setTab('diagnostics')}><MoreHorizontal size={18}/></button></div>
            <button className={`component-row ${selected === 'compressor' ? 'selected' : ''}`} onClick={() => setSelected('compressor')}><span className="component-icon"><Wind size={18}/></span><span><b>Compressor</b><small>{fmt(data?.compressor.currentAmps, 2)} A <i/> {fmt(data?.compressor.vibrationHz, 0)} Hz vibration</small></span><span className={`state-pill ${!data?.compressor.running ? 'neutral' : ''}`}>{!data ? '—' : data.compressor.running ? 'Running' : 'Idle'}</span></button>
            <button className={`component-row ${selected === 'door' ? 'selected' : ''}`} onClick={() => setSelected('door')}><span className="component-icon">{data?.doorOpen ? <DoorOpen size={18}/> : <DoorClosed size={18}/>}</span><span><b>Door status</b><small>{data?.doorOpen ? 'Ambient air entering cabinet' : 'Low-E insulated glass'}</small></span><span className={`state-pill ${data?.doorOpen ? 'amber' : 'neutral'}`}>{!data ? '—' : data.doorOpen ? 'Open' : 'Closed'}</span></button>
            <button className="component-row" onClick={openSettings}><span className="component-icon"><Gauge size={18}/></span><span><b>Temperature controller</b><small>Set point {fmt(data?.temperature.setpoint)}°C</small></span><ChevronRight size={16}/></button>
            <div className="system-health"><ShieldCheck size={15}/><span>{!isLive ? 'Waiting for fresh device data' : data?.alarms.length ? 'Review the active alerts above' : 'No active device alerts'}</span></div>
          </section>
        </aside>
      </div>
      <div className={`bottom-grid ${tab !== 'overview' ? 'detail-layout' : ''}`}>
        {tab === 'diagnostics' ? <Diagnostics data={data}/> : tab === 'inventory' ? <Inventory expanded data={data} enabled={enabled} onSlot={(row, col, filled) => void send('set-stock', { row, col, filled })} onRestock={() => void send('restock', undefined, 'All 40 inventory slots replenished.')}/> : <section className="panel chart-panel"><div className="panel-heading"><div><h2><Activity size={16}/>Temperature history</h2><p>The cabinet climate, second by second.</p></div><div className="range-switch"><button className={range === 60 ? 'active' : ''} onClick={() => setRange(60)}>1 min</button><button className={range === 300 ? 'active' : ''} onClick={() => setRange(300)}>5 min</button></div></div><TemperatureChart history={history} range={range}/><div className="chart-footer"><div className="chart-legend"><span><i className="zone-dot top"/>Top zone</span><span><i className="zone-dot middle"/>Middle zone</span><span><i className="zone-dot bottom"/>Bottom zone</span></div><span>{history.length} samples received</span></div></section>}
        {tab === 'overview' ? <Inventory data={data} enabled={enabled} onSlot={(row, col, filled) => void send('set-stock', { row, col, filled })} onRestock={() => void send('restock', undefined, 'All 40 inventory slots replenished.')}/> : <section className="panel detail-note"><div className="note-icon">{tab === 'inventory' ? <Package size={24}/> : <Activity size={24}/>}</div><h2>{tab === 'inventory' ? 'Every slot, accounted for.' : 'Understand the refrigeration cycle.'}</h2><p>{tab === 'inventory' ? `${data ? 40 - stockCount : '—'} empty slots are ready to replenish. Inventory is synchronized with the physical positions in your 3D view.` : 'Open the door to introduce ambient air. Temperature and humidity rise, and the thermostat engages the compressor to recover.'}</p><button className="secondary-button" disabled={!enabled} onClick={tab === 'inventory' ? () => void send('restock', undefined, 'All slots replenished.') : toggleDoor}>{tab === 'inventory' ? <><RefreshCw size={15}/>Replenish inventory</> : <><DoorOpen size={15}/>{data?.doorOpen ? 'Close door' : 'Simulate door opening'}</>}</button></section>}
      </div>
      <footer className="page-footer"><span><CoolerMark small/>Cooler Studio <i/> Connected equipment, made visible.</span><span>{data?.source === 'hardware' ? 'Hardware telemetry' : 'Physics-inspired simulation'}<i/>v1.0<button onClick={() => setModal('about')}>About this twin <ArrowRight size={12}/></button></span></footer>
    </main></div>
    {(notice || error) && <div className={`toast ${notice?.error || error ? 'error' : ''}`} role="status">{notice?.error || error ? <Activity size={17}/> : <Check size={17}/>}<span>{notice?.message || error}</span><button aria-label="Dismiss notification" onClick={() => { setNotice(null); clearError() }}><X size={16}/></button></div>}
    {modal && <Dialog title={modal === 'settings' ? 'Cooler controls' : modal === 'connection' ? 'Telemetry connection' : 'A closer look at your digital twin'} onClose={() => setModal(null)}>
      {modal === 'settings' ? <><p>Adjust the simulated thermostat. Changes are applied after the device service confirms your command.</p><label className="setpoint-label" htmlFor="setpoint">Temperature set point <strong>{setpoint.toFixed(1)}°C</strong></label><input id="setpoint" type="range" min="2" max="6" step="0.5" value={setpoint} onChange={e => setSetpoint(Number(e.target.value))}/><div className="scale-labels"><span>2°C · Cooler</span><span>6°C · Warmer</span></div><button className="primary-button full-width" disabled={!enabled} onClick={async () => { try { await command('set-setpoint', setpoint); setModal(null); showNotice(`Set point updated to ${setpoint.toFixed(1)}°C.`) } catch (err) { showNotice(String(err), true) } }}><Check size={16}/>{pending ? 'Waiting for confirmation…' : 'Apply set point'}</button><div className="dialog-section"><h3>Simulation session</h3><p>Reset temperatures, energy counters, and shelf stock to their initial values.</p><button className="secondary-button" disabled={!enabled} onClick={() => void send('reset', undefined, 'Simulation reset to initial conditions.')}><RefreshCw size={15}/>Reset simulation</button></div></> : modal === 'connection' ? <><p>The twin receives validated sensor snapshots once per second over a persistent WebSocket connection.</p><dl className="spec-list"><div><dt>Status</dt><dd>{connection}</dd></div><div><dt>Data source</dt><dd>{data?.source ?? 'Awaiting connection'}</dd></div><div><dt>Device ID</dt><dd>{data?.deviceId ?? '—'}</dd></div><div><dt>Sequence</dt><dd>{data?.sequence ?? '—'}</dd></div><div><dt>Last received</dt><dd>{data ? new Date(data.timestamp).toLocaleTimeString() : '—'}</dd></div><div><dt>Command status</dt><dd>{pending ? 'Awaiting acknowledgment' : 'Ready'}</dd></div></dl><p className="dialog-callout">For physical sensors, configure the server’s MQTT adapter. The same schema powers this interface; hardware commands require acknowledgment from the device.</p></> : <><div className="about-hero"><CoolerMark/><div><h3>One asset. A complete perspective.</h3><span>Imbera G319 inspired · Single glass door merchandiser</span></div></div><p>A Blender-built, Draco-compressed digital asset with five stocked shelves, an animated glass door, baked ambient occlusion, and synchronized component telemetry.</p><dl className="spec-list"><div><dt>Cabinet</dt><dd>Approx. 2.0 × 0.75 × 0.72 m</dd></div><div><dt>Storage</dt><dd>5 shelves · 40 tracked front slots</dd></div><div><dt>Interaction</dt><dd>Orbit, zoom, inspect, open, restock</dd></div></dl><p className="dialog-callout">This is an independent visualization inspired by the Imbera/Coca-Cola GDM style. Sensor values and behavior are synthetic and are not calibrated to a physical appliance. The component map is a visual guide, not a thermal camera.</p><a className="text-button" href="https://us.imberacooling.com/products/g319/" target="_blank" rel="noreferrer">View manufacturer reference <ArrowRight size={14}/></a></>}
    </Dialog>}
  </div>
}
