import { useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { auditEntries, branches } from '../data/mock';
import type { AuditActionKind, AuditEntry } from '../types';
import {
  Bot, User2, Cpu, Search, Download, ShieldCheck,
  LogIn, LogOut, Lock, Unlock, RefreshCcw, Power,
  PackagePlus, Edit3, Plus, Trash2, Shuffle, AlertTriangle,
  ArrowUpRight, CheckCircle2, Settings2, Filter,
} from 'lucide-react';

type ActorKind = AuditEntry['actor']['kind'];
type ResultKind = AuditEntry['result'];

const actorIcon: Record<ActorKind, React.ComponentType<{ size?: number }>> = {
  user: User2, agent: Bot, system: Cpu,
};
const actorColor: Record<ActorKind, string> = {
  user:   'var(--accent-2)',
  agent:  'var(--accent)',
  system: 'var(--text-muted)',
};

const actionIcon: Record<AuditActionKind, React.ComponentType<{ size?: number }>> = {
  'auth.login':         LogIn,
  'auth.logout':        LogOut,
  'door.unlock':        Unlock,
  'door.lock':          Lock,
  'device.reboot':      RefreshCcw,
  'device.disable':     Power,
  'firmware.push':      PackagePlus,
  'firmware.rollback':  PackagePlus,
  'policy.create':      Plus,
  'policy.update':      Edit3,
  'policy.delete':      Trash2,
  'wan.failover':       Shuffle,
  'incident.create':    AlertTriangle,
  'incident.resolve':   CheckCircle2,
  'incident.escalate':  ArrowUpRight,
  'incident.approve':   ShieldCheck,
  'agent.action':       Bot,
  'agent.proposal':     Bot,
  'config.change':      Settings2,
};

const actionLabel: Record<AuditActionKind, string> = {
  'auth.login':         'Sign-in',
  'auth.logout':        'Sign-out',
  'door.unlock':        'Door unlock',
  'door.lock':          'Door lock',
  'device.reboot':      'Device reboot',
  'device.disable':     'Device disabled',
  'firmware.push':      'Firmware push',
  'firmware.rollback':  'Firmware rollback',
  'policy.create':      'Policy created',
  'policy.update':      'Policy updated',
  'policy.delete':      'Policy deleted',
  'wan.failover':       'WAN failover',
  'incident.create':    'Incident created',
  'incident.resolve':   'Incident resolved',
  'incident.escalate':  'Incident escalated',
  'incident.approve':   'Action approved',
  'agent.action':       'Agent action',
  'agent.proposal':     'Agent proposal',
  'config.change':      'Config changed',
};

const resultBadge: Record<ResultKind, string> = { success: 'ok', failure: 'err', pending: 'warn' };

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
function timeAgo(iso: string) {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function dateBucket(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function AuditLogPage() {
  const [query, setQuery] = useState('');
  const [actorFilter, setActorFilter] = useState<ActorKind | 'all'>('all');
  const [branchFilter, setBranchFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    return [...auditEntries]
      .filter((e) => actorFilter === 'all' || e.actor.kind === actorFilter)
      .filter((e) => branchFilter === 'all' || e.branchId === branchFilter)
      .filter((e) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return (
          e.actor.name.toLowerCase().includes(q) ||
          actionLabel[e.action].toLowerCase().includes(q) ||
          e.target?.label.toLowerCase().includes(q) ||
          e.details?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [query, actorFilter, branchFilter]);

  // Group by day
  const grouped = useMemo(() => {
    const groups = new Map<string, AuditEntry[]>();
    for (const e of filtered) {
      const k = dateBucket(e.ts);
      const arr = groups.get(k) ?? [];
      arr.push(e);
      groups.set(k, arr);
    }
    return [...groups.entries()];
  }, [filtered]);

  const counts = useMemo(() => ({
    total:  auditEntries.length,
    user:   auditEntries.filter((e) => e.actor.kind === 'user').length,
    agent:  auditEntries.filter((e) => e.actor.kind === 'agent').length,
    system: auditEntries.filter((e) => e.actor.kind === 'system').length,
  }), []);

  return (
    <>
      <PageHeader
        title="Audit Log"
        subtitle="Immutable record of every action — every door unlock, policy change, firmware push, and agent decision."
        right={
          <div className="toolbar">
            <button><Filter size={14} />Date range</button>
            <button><Download size={14} />Export CSV</button>
          </div>
        }
      />

      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <Mk label="Total events"    value={String(counts.total)}  icon={Cpu}    color="var(--accent)" />
        <Mk label="Human actions"   value={String(counts.user)}   icon={User2}  color="var(--accent-2)" />
        <Mk label="Agent actions"   value={String(counts.agent)}  icon={Bot}    color="var(--accent)" />
        <Mk label="System events"   value={String(counts.system)} icon={Cpu}    color="var(--text-muted)" />
      </div>

      <Card
        title={`Activity · ${filtered.length} entries`}
        sub="Newest first"
        right={
          <div className="toolbar">
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
              <input
                placeholder="Search actor / action / target"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingLeft: 30, minWidth: 260 }}
              />
            </div>
            <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value as ActorKind | 'all')}>
              <option value="all">All actors</option>
              <option value="user">Humans</option>
              <option value="agent">Agents</option>
              <option value="system">System</option>
            </select>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="all">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        }
      >
        {grouped.map(([day, list]) => (
          <div key={day}>
            <div className="audit-day">
              <span>{day}</span>
              <span style={{ flex: 1, height: 1, background: 'var(--border)', marginLeft: 12 }} />
              <span className="mono" style={{ color: 'var(--text-muted)' }}>{list.length} events</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {list.map((e) => <AuditRow key={e.id} entry={e} />)}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>No entries match the current filters.</div>
        )}
      </Card>
    </>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const ActorIcon = actorIcon[entry.actor.kind];
  const ActionIcon = actionIcon[entry.action];
  const branch = branches.find((b) => b.id === entry.branchId);

  return (
    <div className="audit-row">
      <div className="audit-time">
        <span className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>{fmtTime(entry.ts)}</span>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{timeAgo(entry.ts)}</span>
      </div>

      <div className="audit-actor" title={entry.actor.kind}>
        <span style={{ color: actorColor[entry.actor.kind], display: 'inline-flex' }}>
          <ActorIcon size={14} />
        </span>
        <span style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.actor.name}</span>
      </div>

      <div className="audit-action">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)' }}>
          <ActionIcon size={13} />
          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{actionLabel[entry.action]}</span>
        </span>
        {entry.target && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <span className="mono">{entry.target.label}</span>
          </span>
        )}
      </div>

      <div className="audit-meta">
        {branch && <span className="badge" style={{ fontSize: 10 }}>{branch.name}</span>}
        <span className={`badge ${resultBadge[entry.result]}`}>{entry.result}</span>
      </div>

      {entry.details && (
        <div className="audit-details">{entry.details}{entry.ip ? ` · IP ${entry.ip}` : ''}</div>
      )}
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
