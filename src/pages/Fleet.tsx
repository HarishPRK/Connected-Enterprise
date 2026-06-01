import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { StatusBadge } from '../components/StatusBadge';
import { Sparkline } from '../components/widgets/Sparkline';
import { branches, fleetStats } from '../data/mock';
import { useThemeColors } from '../ui/Theme';
import {
  Building2, ArrowUpRight, Activity, Cpu, ShieldAlert,
  Search, Download, MapPin,
} from 'lucide-react';
import { AiInsightCard } from '../components/widgets/AiInsightCard';

type SortKey = 'name' | 'health' | 'uptime' | 'devices' | 'alerts' | 'throughput';

export function FleetPage() {
  const nav = useNavigate();
  const c = useThemeColors();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('health');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const enriched = branches.map((b) => ({ ...b, stats: fleetStats[b.id] }));

  const filtered = useMemo(() => {
    const list = enriched.filter((b) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return b.name.toLowerCase().includes(q) || b.location.toLowerCase().includes(q);
    });
    list.sort((a, b) => {
      let av = 0, bv = 0;
      switch (sortKey) {
        case 'name':       return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
        case 'health':     av = a.stats.healthScore;       bv = b.stats.healthScore;       break;
        case 'uptime':     av = a.stats.uptimePct;          bv = b.stats.uptimePct;          break;
        case 'devices':    av = a.stats.devicesOnline;      bv = b.stats.devicesOnline;      break;
        case 'alerts':     av = a.stats.openAlerts;         bv = b.stats.openAlerts;         break;
        case 'throughput': av = a.stats.throughputMbps;     bv = b.stats.throughputMbps;     break;
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [enriched, query, sortKey, sortDir]);

  const totals = useMemo(() => {
    const s = Object.values(fleetStats);
    return {
      branches: branches.length,
      healthy: s.filter((x) => x.status === 'ok').length,
      degraded: s.filter((x) => x.status === 'warn').length,
      offline: s.filter((x) => x.status === 'err').length,
      devicesOnline: s.reduce((sum, x) => sum + x.devicesOnline, 0),
      totalDevices: s.reduce((sum, x) => sum + x.totalDevices, 0),
      alerts: s.reduce((sum, x) => sum + x.openAlerts, 0),
      throughput: s.reduce((sum, x) => sum + x.throughputMbps, 0),
      avgUptime: s.reduce((sum, x) => sum + x.uptimePct, 0) / s.length,
    };
  }, []);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'name' ? 'asc' : 'desc'); }
  }

  return (
    <>
      <PageHeader
        title="Fleet"
        subtitle={`Multi-branch ops view — ${branches.length} sites under management`}
        right={
          <div className="toolbar">
            <button><Download size={14} />Export</button>
            <button className="primary"><Building2 size={14} />Add branch</button>
          </div>
        }
      />

      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <Mk label="Total branches"  value={String(totals.branches)}     icon={Building2}    color="var(--accent)" />
        <Mk label="Healthy"         value={`${totals.healthy}/${totals.branches}`} icon={Activity} color="var(--ok)" />
        <Mk label="Devices online"  value={`${totals.devicesOnline}/${totals.totalDevices}`} icon={Cpu} color="var(--accent-2)" />
        <Mk label="Open alerts"     value={String(totals.alerts)}       icon={ShieldAlert}  color="var(--warn)" />
        <Mk label="Avg uptime (30d)" value={`${totals.avgUptime.toFixed(2)}%`} icon={Activity} color="var(--ok)" />
      </div>

      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <AiInsightCard
          topic="fleet"
          subtitle="Bedrock executive readout across all branches"
          data={{
            totals,
            branches: enriched.map((b) => ({
              id: b.id,
              name: b.name,
              location: b.location,
              gatewayModel: b.gatewayModel,
              firmware: b.firmware,
              status: b.stats.status,
              healthScore: b.stats.healthScore,
              uptimePct: b.stats.uptimePct,
              devicesOnline: b.stats.devicesOnline,
              totalDevices: b.stats.totalDevices,
              openAlerts: b.stats.openAlerts,
              throughputMbps: b.stats.throughputMbps,
            })),
          }}
        />
      </div>

      <Card
        title="Branches"
        sub={`${filtered.length} shown · click a row to drill in`}
        right={
          <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
            <input
              placeholder="Search name or city"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ paddingLeft: 30, minWidth: 240 }}
            />
          </div>
        }
      >
        <table className="fleet-table">
          <thead>
            <tr>
              <th><SortHead label="Branch"      k="name"       sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
              <th>Location</th>
              <th>Gateway</th>
              <th><SortHead label="Health"      k="health"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
              <th><SortHead label="Uptime 30d"  k="uptime"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
              <th><SortHead label="Devices"     k="devices"    sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
              <th><SortHead label="Alerts"      k="alerts"     sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
              <th><SortHead label="Throughput"  k="throughput" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} /></th>
              <th>Trend</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((b) => {
              const s = b.stats;
              const healthColor = s.status === 'ok' ? c.ok : s.status === 'warn' ? c.warn : c.err;
              return (
                <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => nav('/')}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: healthColor, boxShadow: `0 0 10px ${healthColor}80` }} />
                      <span style={{ color: 'var(--text)', fontWeight: 500 }}>{b.name}</span>
                    </div>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-dim)' }}>
                      <MapPin size={12} />{b.location}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span className="mono" style={{ fontSize: 12 }}>{b.gatewayModel}</span>
                      <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>fw {b.firmware}</span>
                    </div>
                  </td>
                  <td>
                    <HealthBar score={s.healthScore} status={s.status} />
                  </td>
                  <td className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{s.uptimePct.toFixed(2)}%</td>
                  <td>
                    <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{s.devicesOnline}/{s.totalDevices}</span>
                  </td>
                  <td>
                    {s.openAlerts > 0
                      ? <span className="badge warn">{s.openAlerts}</span>
                      : <span className="badge ok">0</span>}
                  </td>
                  <td className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>{s.throughputMbps} Mbps</td>
                  <td>
                    <Sparkline values={s.throughputSeries} width={80} height={26} stroke={c.accent} />
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)' }}>
                      <span style={{ fontSize: 11 }}>Open</span>
                      <ArrowUpRight size={13} />
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No branches match your search.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <div style={{ height: 16 }} />
      <div className="grid">
        <div className="col-6">
          <Card title="Branches by status" sub="Snapshot · live">
            <StatusDistribution healthy={totals.healthy} degraded={totals.degraded} offline={totals.offline} total={totals.branches} />
          </Card>
        </div>
        <div className="col-6">
          <Card title="Fleet throughput" sub={`${totals.throughput} Mbps total · last 24h aggregate`}>
            <FleetThroughput />
          </Card>
        </div>
      </div>
    </>
  );
}

function HealthBar({ score, status }: { score: number; status: 'ok' | 'warn' | 'err' | 'off' }) {
  const c = useThemeColors();
  const color = status === 'ok' ? c.ok : status === 'warn' ? c.warn : c.err;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
      <span className="mono" style={{ width: 36, color, fontVariantNumeric: 'tabular-nums' }}>{Math.round(score * 100)}</span>
      <div style={{ width: 70, height: 5, background: 'rgba(var(--accent-rgb) / 0.10)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${score * 100}%`, height: '100%', background: color }} />
      </div>
    </div>
  );
}

function SortHead({
  label, k, sortKey, sortDir, onClick,
}: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc'; onClick: (k: SortKey) => void;
}) {
  const isActive = sortKey === k;
  return (
    <button
      onClick={() => onClick(k)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0,
        background: 'transparent', border: 'none', color: isActive ? 'var(--text)' : 'var(--text-muted)',
        font: 'inherit', cursor: 'pointer',
      }}
    >
      {label}
      {isActive && <span style={{ fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );
}

function StatusDistribution({ healthy, degraded, offline, total }: { healthy: number; degraded: number; offline: number; total: number }) {
  const c = useThemeColors();
  const items = [
    { label: 'Healthy',  n: healthy,  color: c.ok },
    { label: 'Degraded', n: degraded, color: c.warn },
    { label: 'Offline',  n: offline,  color: c.err },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 12, background: 'rgba(var(--accent-rgb) / 0.06)' }}>
        {items.map((i) => i.n > 0 && (
          <div key={i.label} style={{ width: `${(i.n / total) * 100}%`, background: i.color }} title={`${i.label}: ${i.n}`} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {items.map((i) => (
          <div key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: i.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--text-dim)' }}>{i.label}</span>
            <span style={{ color: 'var(--text)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{i.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FleetThroughput() {
  const c = useThemeColors();
  // Sum series across branches
  const len = 24;
  const summed = Array.from({ length: len }, (_, i) =>
    Object.values(fleetStats).reduce((s, x) => s + (x.throughputSeries[i] ?? 0), 0),
  );
  const max = Math.max(...summed);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 100, paddingTop: 8 }}>
      {summed.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${(v / max) * 100}%`,
            background: `linear-gradient(180deg, ${c.accent}, rgba(var(--accent-rgb) / 0.3))`,
            borderRadius: '3px 3px 0 0',
            minHeight: 4,
          }}
          title={`${i}:00 · ${v} Mbps`}
        />
      ))}
    </div>
  );
}

function Mk({ label, value, icon: Icon, color }: { label: string; value: string; icon: React.ComponentType<{ size?: number }>; color: string }) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div className="kpi-icon" style={{ color, background: `linear-gradient(135deg, ${color}33, transparent)` }}>
          <Icon size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-mid"><div className="kpi-value">{value}</div></div>
    </div>
  );
}

// silence unused import warning for StatusBadge
void StatusBadge;
