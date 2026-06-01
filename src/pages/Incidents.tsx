import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Sparkline } from '../components/widgets/Sparkline';
import { useToast } from '../ui/Toast';
import { useThemeColors } from '../ui/Theme';
import { useLiveData } from '../ui/LiveData';
import { runAgentSSE } from '../ui/agentClient';
import { RichText } from '../ui/markdown';
import { branches, incidents as seed } from '../data/mock';
import type { AgentStep, AgentStepKind, Incident, IncidentSeverity, IncidentStatus, PendingAction } from '../types';
import {
  AlertOctagon, Bot, Brain, CheckCircle2, ChevronDown, ChevronRight, Cpu, FileSearch,
  Filter, Search, ShieldAlert, Sparkles, Target, Wrench, Zap, ArrowUpRight,
  Clock,
} from 'lucide-react';

const sevOrder: Record<IncidentSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const sevBadge: Record<IncidentSeverity, string> = { critical: 'err', high: 'err', medium: 'warn', low: '' };
const sevLabel: Record<IncidentSeverity, string> = { critical: 'CRITICAL', high: 'HIGH', medium: 'MED', low: 'LOW' };

const statusBadge: Record<IncidentStatus, string> = {
  triaging: 'warn', investigating: 'warn', awaiting_approval: 'warn',
  resolving: '', resolved: 'ok', escalated: 'err',
};
const statusLabel: Record<IncidentStatus, string> = {
  triaging: 'Triaging', investigating: 'Investigating', awaiting_approval: 'Awaiting approval',
  resolving: 'Resolving', resolved: 'Resolved', escalated: 'Escalated',
};

function timeAgo(iso: string) {
  const m = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/* ── Synthetic 14-day incident trend ──────────────────────────────────────
 * Deterministic per-day counts so the chart looks alive without changing on
 * each re-render. Stack components: auto-resolved (Claude agent), still-open
 * (in flight), escalated (handed to NetEng). */
interface TrendPoint {
  day: string;
  autoResolved: number;
  open: number;
  escalated: number;
}

function buildIncidentsTrend(days = 14): TrendPoint[] {
  const today = new Date();
  const out: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const seed = (d.getDate() * 31 + d.getMonth() * 7 + 17) >>> 0;
    // 2-6 incidents per day, weighted toward auto-resolved
    const total = 2 + (seed % 5);
    const autoResolved = Math.max(1, Math.floor(total * (0.65 + ((seed >> 3) % 3) * 0.05)));
    const escalated = Math.min(total - autoResolved, ((seed >> 5) & 1));
    const open = Math.max(0, total - autoResolved - escalated);
    out.push({
      day: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      autoResolved, open, escalated,
    });
  }
  return out;
}

/* Incident that gets injected when LiveDataProvider's `newIncidentTrigger` fires.
   Designed to feel "fresh" — investigating status with steps that stream in. */
const liveIncidentTemplate = (): Incident => ({
  id: 'INC-2026-0143',
  title: 'POS-02 packet loss spike',
  branchId: 'b-dal-hq',
  severity: 'medium',
  status: 'investigating',
  assignee: 'agent',
  agentName: 'IT Specialist',
  createdISO: new Date().toISOString(),
  confidence: 0.62,
  steps: [
    { id: 'l1', ts: 0,    kind: 'system',     content: 'Anomaly: POS-02 packet loss 8.4% (baseline <0.5%)' },
    { id: 'l2', ts: 1100, kind: 'system',     content: 'Auto-assigned to IT Specialist (model: claude-sonnet-4-6)' },
    { id: 'l3', ts: 2400, kind: 'thought',    content: 'Payment terminal with sustained loss is high impact. Pulling Wi-Fi signal first to rule out RF.' },
    { id: 'l4', ts: 3700, kind: 'tool_call',  tool: 'get_wifi_client', args: { mac: 'AA:11:22:33:44:5A' }, content: 'Reading POS-02 Wi-Fi state' },
    { id: 'l5', ts: 5100, kind: 'tool_result',tool: 'get_wifi_client', ok: true, resultPreview: '{ rssi: -78, retries: 31%, channel: 36, neighbors: 9 }', content: 'Marginal signal: -78 dBm with 31% retries, 9 neighbor APs on ch 36' },
    { id: 'l6', ts: 6500, kind: 'thought',    content: 'Channel 36 is congested (9 neighbor APs). High retry rate explains the loss. Looking for a cleaner channel.' },
    { id: 'l7', ts: 8000, kind: 'tool_call',  tool: 'scan_channels', args: { band: '5GHz' }, content: 'Scanning 5GHz channels' },
    { id: 'l8', ts: 9400, kind: 'tool_result',tool: 'scan_channels', ok: true, resultPreview: '{ best: 149, neighbors: 1, recommendation: "ch 149" }', content: 'Channel 149 has only 1 neighbor — recommended' },
  ],
});

export function IncidentsPage() {
  const [list, setList] = useState<Incident[]>(seed);
  const [selectedId, setSelectedId] = useState<string>(seed[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | 'all'>('all');
  const { newIncidentTrigger } = useLiveData();
  const { push } = useToast();
  const lastTriggerRef = useRef(0);

  // When the live trigger fires, prepend a fresh INC-0143 (only once).
  useEffect(() => {
    if (newIncidentTrigger === 0) return;
    if (lastTriggerRef.current === newIncidentTrigger) return;
    lastTriggerRef.current = newIncidentTrigger;
    setList((prev) => {
      if (prev.find((i) => i.id === 'INC-2026-0143')) return prev;
      return [liveIncidentTemplate(), ...prev];
    });
    setSelectedId('INC-2026-0143');
  }, [newIncidentTrigger]);

  const filtered = useMemo(() => {
    return [...list]
      .filter((i) => statusFilter === 'all' || i.status === statusFilter)
      .filter((i) => !query || i.title.toLowerCase().includes(query.toLowerCase()) || i.id.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        // Open ones first, then severity, then newest
        const openA = a.status === 'resolved' || a.status === 'escalated' ? 1 : 0;
        const openB = b.status === 'resolved' || b.status === 'escalated' ? 1 : 0;
        if (openA !== openB) return openA - openB;
        if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity];
        return new Date(b.createdISO).getTime() - new Date(a.createdISO).getTime();
      });
  }, [list, statusFilter, query]);

  const selected = list.find((i) => i.id === selectedId);

  // KPI stats
  const stats = useMemo(() => {
    const open = list.filter((i) => i.status !== 'resolved' && i.status !== 'escalated').length;
    const awaiting = list.filter((i) => i.status === 'awaiting_approval').length;
    const autoResolved = list.filter((i) => i.status === 'resolved' && i.assignee === 'agent').length;
    const escalated = list.filter((i) => i.status === 'escalated').length;
    return { open, awaiting, autoResolved, escalated };
  }, [list]);

  // ─── Live Claude agent runner ───
  // Streams real Claude responses via /api/agent/run and appends them as
  // additional steps onto the incident in-place.
  const [liveRunningId, setLiveRunningId] = useState<string | null>(null);
  const stopLiveRef = useRef<(() => void) | null>(null);

  function appendLiveStep(id: string, step: AgentStep) {
    setList((prev) =>
      prev.map((inc) => (inc.id === id ? { ...inc, steps: [...inc.steps, step] } : inc)),
    );
  }
  function setIncidentStatus(id: string, status: IncidentStatus, patch?: Partial<Incident>) {
    setList((prev) =>
      prev.map((inc) => (inc.id === id ? { ...inc, status, ...patch } : inc)),
    );
  }

  function runLiveAgent(inc: Incident) {
    if (liveRunningId) return;
    setLiveRunningId(inc.id);
    setIncidentStatus(inc.id, 'investigating');
    appendLiveStep(inc.id, {
      id: `live-${Date.now()}`,
      ts: 0,
      kind: 'system',
      content: '── Live Claude agent attached · streaming responses ──',
    });

    let stepIdx = 1;
    const mkId = () => `live-${Date.now()}-${stepIdx++}`;

    // Track whether we saw a proposal (= awaiting_approval) during the run, so
    // when the stream closes we can pick the right terminal status.
    let sawProposal = false;
    let lastThoughtContent: string | undefined;

    stopLiveRef.current = runAgentSSE(
      {
        incident: {
          id: inc.id, title: inc.title, branchId: inc.branchId,
          severity: inc.severity, agentName: inc.agentName,
        },
      },
      {
        onEvent: ({ event, data }) => {
          // ── Terminal events: shape final incident state, don't render as steps ──
          if (event === 'done') {
            const reason = (data.reason as string) ?? 'end_turn';
            if (sawProposal || reason === 'awaiting_approval') {
              setIncidentStatus(inc.id, 'awaiting_approval');
            } else {
              setIncidentStatus(inc.id, 'resolved', {
                resolvedISO: new Date().toISOString(),
                postMortem: lastThoughtContent,
              });
            }
            return;
          }
          if (event === 'proposal') {
            // Build a structured PendingAction from the agent's request_human_approval input.
            const args = (data.args as Record<string, unknown>) ?? {};
            const pending: PendingAction = {
              description: (args.action as string) ?? 'Pending action proposed by agent',
              tool:        (args.tool as string)   ?? '',
              args:        (args.args as Record<string, unknown>) ?? {},
              riskLevel:   ((args.risk as string) ?? 'medium') as 'low' | 'medium' | 'high',
              reason:      (args.reason as string) ?? 'Agent requested human approval.',
            };
            sawProposal = true;
            setList((prev) =>
              prev.map((i) => (i.id === inc.id ? { ...i, pendingAction: pending } : i)),
            );
            // Also append a visible "proposal" step in the timeline.
            appendLiveStep(inc.id, {
              id: mkId(), ts: 0, kind: 'proposal',
              content: pending.description,
            });
            return;
          }

          // ── Streaming step events ──
          const kindMap: Record<string, AgentStepKind> = {
            system: 'system', thought: 'thought',
            tool_call: 'tool_call', tool_result: 'tool_result',
          };
          const kind = kindMap[event];
          if (!kind) return;

          const content =
            (data.content as string) ??
            (data.message as string) ??
            (event === 'tool_call'   ? `Calling ${data.tool}` :
             event === 'tool_result' ? `Result from ${data.tool}` : '');

          if (kind === 'thought') lastThoughtContent = content;

          appendLiveStep(inc.id, {
            id: mkId(),
            ts: 0,
            kind,
            content,
            tool: data.tool as string | undefined,
            args: data.args as Record<string, unknown> | undefined,
            ok: data.ok as boolean | undefined,
            resultPreview:
              event === 'tool_result' && data.result != null
                ? JSON.stringify(data.result, null, 2)
                : undefined,
          });
        },
        onError: (msg) => {
          appendLiveStep(inc.id, {
            id: mkId(), ts: 0, kind: 'system',
            content: `Agent error: ${msg}`,
          });
          setIncidentStatus(inc.id, 'escalated');
          push({ kind: 'error', title: 'Live agent failed', detail: msg });
          setLiveRunningId(null);
        },
        onDone: () => {
          setLiveRunningId(null);
        },
      },
    );
  }

  function stopLiveAgent() {
    stopLiveRef.current?.();
    stopLiveRef.current = null;
    setLiveRunningId(null);
  }

  function applyApproval(id: string) {
    setList((prev) =>
      prev.map((inc) => {
        if (inc.id !== id || !inc.pendingAction || !inc.postApprovalSteps) return inc;
        return {
          ...inc,
          status: 'resolving' as IncidentStatus,
          pendingAction: undefined,
          steps: [...inc.steps, ...inc.postApprovalSteps],
          postApprovalSteps: undefined,
        };
      }),
    );
    // Mark resolved a beat after the steps finish playing
    window.setTimeout(() => {
      setList((prev) =>
        prev.map((inc) =>
          inc.id === id
            ? { ...inc, status: 'resolved', resolvedISO: new Date().toISOString() }
            : inc,
        ),
      );
    }, 11_500);
  }

  function escalate(id: string) {
    setList((prev) =>
      prev.map((inc) =>
        inc.id === id
          ? { ...inc, status: 'escalated', assignee: 'On-call NetEng' }
          : inc,
      ),
    );
  }

  return (
    <>
      <PageHeader
        title="Incidents"
        subtitle="Anomalies become incidents, get assigned to a Claude agent, and resolve themselves — with humans in the loop for risky actions."
        right={
          <div className="toolbar">
            <button><Filter size={14} />Saved filters</button>
            <button className="primary"><Sparkles size={14} />New runbook</button>
          </div>
        }
      />

      <div className="kpi-strip" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <MiniKpi label="Open"           value={String(stats.open)}         icon={AlertOctagon} accent="var(--err)" />
        <MiniKpi label="Awaiting approval" value={String(stats.awaiting)}  icon={ShieldAlert}  accent="var(--warn)" />
        <MiniKpi label="Auto-resolved"  value={String(stats.autoResolved)} icon={Bot}          accent="var(--ok)" sub="by agents" />
        <MiniKpi label="Escalated"      value={String(stats.escalated)}    icon={ArrowUpRight} accent="var(--accent-2)" sub="to humans" />
      </div>

      <div className="grid">
        <div className="col-12"><IncidentsTrend /></div>
        <div className="col-5">
          <Card
            title={`Inbox · ${filtered.length}`}
            sub="Open incidents first, then by severity"
            right={
              <div className="toolbar">
                <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, color: 'var(--text-muted)' }} />
                  <input
                    placeholder="Search ID or title"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    style={{ paddingLeft: 30, minWidth: 200 }}
                  />
                </div>
              </div>
            }
          >
            <div className="toolbar" style={{ marginBottom: 4 }}>
              {(['all', 'investigating', 'awaiting_approval', 'resolved', 'escalated'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  style={s === statusFilter
                    ? { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }
                    : undefined}
                >
                  {s === 'all' ? 'All' : statusLabel[s]}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.map((inc) => (
                <IncidentRow
                  key={inc.id}
                  inc={inc}
                  selected={inc.id === selectedId}
                  onClick={() => setSelectedId(inc.id)}
                />
              ))}
              {filtered.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>No incidents match the filters.</div>
              )}
            </div>
          </Card>
        </div>

        <div className="col-7">
          {selected && (
            <IncidentDetail
              incident={selected}
              onApprove={applyApproval}
              onEscalate={escalate}
              liveRunning={liveRunningId === selected.id}
              onRunLive={() => runLiveAgent(selected)}
              onStopLive={stopLiveAgent}
            />
          )}
        </div>
      </div>
    </>
  );
}

/* ─────────────── Inbox row ─────────────── */

function IncidentRow({ inc, selected, onClick }: { inc: Incident; selected: boolean; onClick: () => void }) {
  const branch = branches.find((b) => b.id === inc.branchId);
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: '9px 12px', borderRadius: 10, textAlign: 'left', justifyContent: 'flex-start',
        background: selected ? 'var(--grad-accent-soft)' : 'rgba(var(--accent-rgb) / 0.03)',
        borderColor: selected ? 'var(--accent)' : 'var(--border)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span className={`badge ${sevBadge[inc.severity]}`}>{sevLabel[inc.severity]}</span>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {inc.title}
        </span>
        <span className={`badge ${statusBadge[inc.status]}`}>{statusLabel[inc.status]}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', fontSize: 11, color: 'var(--text-muted)' }}>
        <span className="mono">{inc.id}</span>
        <span>·</span>
        <span>{branch?.name}</span>
        <span>·</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {inc.assignee === 'agent' ? <><Bot size={10} />{inc.agentName ?? 'Agent'}</> : inc.assignee}
        </span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Clock size={10} />{timeAgo(inc.createdISO)}
        </span>
      </div>
    </button>
  );
}

/* ─────────────── Detail panel ─────────────── */

function IncidentDetail({
  incident, onApprove, onEscalate, liveRunning, onRunLive, onStopLive,
}: {
  incident: Incident;
  onApprove: (id: string) => void;
  onEscalate: (id: string) => void;
  liveRunning: boolean;
  onRunLive: () => void;
  onStopLive: () => void;
}) {
  const branch = branches.find((b) => b.id === incident.branchId);
  const { push } = useToast();

  return (
    <Card
      title={
        <span>
          {incident.id} · {incident.title}
        </span>
      }
      sub={`${branch?.name} · ${branch?.location}`}
      right={
        <div className="toolbar">
          <span className={`badge ${sevBadge[incident.severity]}`}>{sevLabel[incident.severity]}</span>
          <span className={`badge ${statusBadge[incident.status]}`}>{statusLabel[incident.status]}</span>
          {liveRunning ? (
            <button onClick={onStopLive} className="danger">
              <span className="dot err" style={{ marginRight: 4 }} />Stop live agent
            </button>
          ) : (
            <button onClick={onRunLive} className="primary" title="Stream real Claude responses for this incident">
              <Sparkles size={14} />Run live Claude agent
            </button>
          )}
        </div>
      }
    >
      <DetailHeader incident={incident} />

      <AgentTimeline incident={incident} />

      {incident.pendingAction && (
        <PendingActionPanel
          action={incident.pendingAction}
          onApprove={() => {
            onApprove(incident.id);
            push({ kind: 'success', title: 'Action approved', detail: `${incident.agentName} is executing now.` });
          }}
          onReject={() => {
            onEscalate(incident.id);
            push({ kind: 'info', title: 'Escalated to human', detail: 'No automated action will run.' });
          }}
        />
      )}

      {incident.postMortem && incident.status === 'resolved' && (
        <PostMortemCard incident={incident} />
      )}

      {incident.status !== 'resolved' && incident.status !== 'escalated' && (
        <div className="toolbar" style={{ paddingTop: 4 }}>
          <button onClick={() => onEscalate(incident.id)}>Escalate to human</button>
        </div>
      )}
    </Card>
  );
}

function DetailHeader({ incident }: { incident: Incident }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap',
      gap: 16, fontSize: 12, color: 'var(--text-muted)',
      padding: '6px 0',
    }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text)' }}>
        {incident.assignee === 'agent'
          ? <><Bot size={12} style={{ color: 'var(--accent)' }} />{incident.agentName}</>
          : <>{incident.assignee}</>}
      </span>
      {incident.confidence != null && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11 }}>Confidence</span>
          <ConfidenceBar value={incident.confidence} />
        </span>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Clock size={11} />Created {timeAgo(incident.createdISO)} ago
      </span>
      {incident.resolvedISO && (
        <span>· Resolved {timeAgo(incident.resolvedISO)} ago</span>
      )}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const c = useThemeColors();
  const color = value > 0.85 ? c.ok : value > 0.65 ? c.warn : c.err;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="mono" style={{ color }}>{value.toFixed(2)}</span>
      <div style={{ width: 80, height: 5, background: 'rgba(var(--accent-rgb) / 0.10)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ width: `${value * 100}%`, height: '100%', background: color, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}

/* ─────────────── Agent timeline ─────────────── */

function AgentTimeline({ incident }: { incident: Incident }) {
  // Live playback for in-flight incidents — reveal steps progressively.
  const isLive = incident.status === 'investigating' || incident.status === 'resolving';
  const [revealCount, setRevealCount] = useState(isLive ? 0 : incident.steps.length);
  const lastIdRef = useRef(incident.id);
  const lastLenRef = useRef(incident.steps.length);

  // Reset playback when switching incident OR when new steps were appended (after approval)
  useEffect(() => {
    const idChanged = lastIdRef.current !== incident.id;
    const lengthGrew = incident.steps.length > lastLenRef.current;

    if (idChanged) {
      setRevealCount(isLive ? 0 : incident.steps.length);
    } else if (lengthGrew) {
      // After approval: keep already-revealed prefix, animate the new tail
      setRevealCount(lastLenRef.current);
    }
    lastIdRef.current = incident.id;
    lastLenRef.current = incident.steps.length;
  }, [incident.id, incident.steps.length, isLive]);

  useEffect(() => {
    if (revealCount >= incident.steps.length) return;
    const next = incident.steps[revealCount];
    const prev = revealCount > 0 ? incident.steps[revealCount - 1] : null;
    const delay = Math.max(450, Math.min(1800, (next.ts - (prev?.ts ?? 0)) / 1.4));
    const t = window.setTimeout(() => setRevealCount((c) => c + 1), delay);
    return () => window.clearTimeout(t);
  }, [revealCount, incident.steps]);

  const visible = incident.steps.slice(0, revealCount);
  const stillStreaming = revealCount < incident.steps.length;

  return (
    <div>
      <div className="agent-timeline-head">
        <Sparkles size={13} style={{ color: 'var(--accent)' }} />
        <span>Agent timeline</span>
        <span style={{ flex: 1 }} />
        {stillStreaming && <span className="badge"><span className="dot ok" /> Streaming</span>}
      </div>
      <div className="agent-timeline">
        {visible.map((step) => <StepCard key={step.id} step={step} />)}
        {stillStreaming && <ThinkingDots />}
      </div>
    </div>
  );
}

function StepCard({ step }: { step: AgentStep }) {
  switch (step.kind) {
    case 'system':      return <StepBlock variant="system"     icon={Cpu}        label="System">{step.content}</StepBlock>;
    case 'thought':     return <StepBlock variant="thought"    icon={Brain}      label="Thought">{step.content}</StepBlock>;
    case 'tool_call':   return <ToolCallStep step={step} />;
    case 'tool_result': return <ToolResultStep step={step} />;
    case 'diagnosis':   return <StepBlock variant="diagnosis"  icon={Target}     label={`Diagnosis · confidence ${step.confidence?.toFixed(2) ?? '—'}`} accent="ok">{step.content}</StepBlock>;
    case 'proposal':    return <StepBlock variant="proposal"   icon={Zap}        label="Proposed action" accent="warn">{step.content}</StepBlock>;
    case 'resolution':  return <StepBlock variant="resolution" icon={CheckCircle2} label="Resolved" accent="ok">{step.content}</StepBlock>;
  }
}

function StepBlock({
  variant, icon: Icon, label, accent, children,
}: {
  variant: string;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  accent?: 'ok' | 'warn' | 'err';
  children: React.ReactNode;
}) {
  const accentColor =
    accent === 'ok'   ? 'var(--ok)'   :
    accent === 'warn' ? 'var(--warn)' :
    accent === 'err'  ? 'var(--err)'  : 'var(--accent)';
  // Run incoming text through the markdown renderer so **bold**, *italic*,
  // bullet lists etc. coming back from the live Claude agent render cleanly.
  const body =
    typeof children === 'string'
      ? <RichText text={children} />
      : children;
  return (
    <div className={`step step-${variant}`} style={{ borderLeftColor: accentColor }}>
      <div className="step-head">
        <span style={{ color: accentColor, display: 'inline-flex' }}><Icon size={13} /></span>
        <span>{label}</span>
      </div>
      <div className="step-body">{body}</div>
    </div>
  );
}

function ToolCallStep({ step }: { step: AgentStep }) {
  const hasArgs = step.args && Object.keys(step.args).length > 0;
  return (
    <div className="step step-tool" style={{ borderLeftColor: 'var(--accent-3)' }}>
      <div className="step-head">
        <span style={{ color: 'var(--accent-3)', display: 'inline-flex' }}><Wrench size={13} /></span>
        <span>Tool call</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{step.tool}()</span>
      </div>
      <div className="step-body">{step.content}</div>
      {hasArgs && <CollapsibleJson label="payload" json={JSON.stringify(step.args, null, 2)} />}
    </div>
  );
}

function ToolResultStep({ step }: { step: AgentStep }) {
  const ok = step.ok !== false;
  const color = ok ? 'var(--ok)' : 'var(--err)';
  return (
    <div className="step step-result" style={{ borderLeftColor: color }}>
      <div className="step-head">
        <span style={{ color, display: 'inline-flex' }}>
          {ok ? <CheckCircle2 size={13} /> : <AlertOctagon size={13} />}
        </span>
        <span>Tool result</span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>← {step.tool}</span>
      </div>
      <div className="step-body">{step.content}</div>
      {step.resultPreview && <CollapsibleJson label="raw response" json={step.resultPreview} />}
    </div>
  );
}

function CollapsibleJson({ label, json }: { label: string; json: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          padding: '3px 8px', fontSize: 10.5,
          alignSelf: 'flex-start',
          color: 'var(--text-muted)',
          background: 'transparent',
          border: '1px dashed var(--border)',
          borderRadius: 6,
        }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {open ? `Hide ${label}` : `Show ${label}`}
      </button>
      {open && <pre className="step-code">{json}</pre>}
    </>
  );
}

function ThinkingDots() {
  return (
    <div className="step step-thinking" style={{ borderLeftColor: 'var(--accent)' }}>
      <div className="step-head">
        <span style={{ color: 'var(--accent)', display: 'inline-flex' }}><FileSearch size={13} /></span>
        <span>Working…</span>
      </div>
      <div className="step-body">
        <span className="dots"><span /><span /><span /></span>
      </div>
    </div>
  );
}

/* ─────────────── Pending action panel ─────────────── */

function PendingActionPanel({
  action, onApprove, onReject,
}: {
  action: PendingAction;
  onApprove: () => void;
  onReject: () => void;
}) {
  const riskColor =
    action.riskLevel === 'high' ? 'var(--err)' :
    action.riskLevel === 'medium' ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="pending-action">
      <div className="pending-action-head">
        <span style={{ color: riskColor, display: 'inline-flex' }}><ShieldAlert size={14} /></span>
        <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>Approval required</span>
        <span className={`badge ${action.riskLevel === 'high' ? 'err' : action.riskLevel === 'medium' ? 'warn' : 'ok'}`} style={{ marginLeft: 'auto' }}>
          {action.riskLevel.toUpperCase()} RISK
        </span>
      </div>
      <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>{action.description}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
        <strong style={{ color: 'var(--text)' }}>Why approval is required:</strong> {action.reason}
      </div>
      <CollapsibleJson label="tool call payload" json={JSON.stringify({ tool: action.tool, args: action.args }, null, 2)} />
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <button onClick={onApprove} className="primary"><CheckCircle2 size={14} />Approve & execute</button>
        <button onClick={onReject}>Reject — escalate to human</button>
      </div>
    </div>
  );
}

/* ─────────────── Post-mortem ─────────────── */

function PostMortemCard({ incident }: { incident: Incident }) {
  return (
    <div className="post-mortem">
      <div className="step-head" style={{ marginBottom: 8 }}>
        <span style={{ color: 'var(--ok)', display: 'inline-flex' }}><CheckCircle2 size={13} /></span>
        <span>Post-mortem</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>auto-written by {incident.agentName}</span>
      </div>
      {incident.rootCause && (
        <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 6 }}>
          <strong style={{ color: 'var(--text)' }}>Root cause:</strong> {incident.rootCause}
        </div>
      )}
      <div style={{ fontSize: 13.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>{incident.postMortem}</div>
    </div>
  );
}

/* ─────────────── Incidents trend (14-day stacked area) ─────────────── */

function IncidentsTrend() {
  const c = useThemeColors();
  const data = useMemo(() => buildIncidentsTrend(14), []);
  const totals = data.reduce(
    (acc, p) => ({
      autoResolved: acc.autoResolved + p.autoResolved,
      open:         acc.open + p.open,
      escalated:    acc.escalated + p.escalated,
    }),
    { autoResolved: 0, open: 0, escalated: 0 },
  );
  const total = totals.autoResolved + totals.open + totals.escalated;
  const autoPct = total ? Math.round((totals.autoResolved / total) * 100) : 0;

  return (
    <Card
      title="Incidents — last 14 days"
      sub={`${total} incidents · ${totals.autoResolved} auto-resolved (${autoPct}%) · ${totals.escalated} escalated`}
      right={
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)' }}>
          <Legend dot={c.ok}      label="Auto-resolved" />
          <Legend dot={c.warn}    label="In flight" />
          <Legend dot={c.accent2} label="Escalated" />
        </div>
      }
    >
      <div style={{ height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="trend-auto" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={c.ok}      stopOpacity={0.75} />
                <stop offset="100%" stopColor={c.ok}      stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="trend-open" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={c.warn}    stopOpacity={0.75} />
                <stop offset="100%" stopColor={c.warn}    stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="trend-esc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={c.accent2} stopOpacity={0.75} />
                <stop offset="100%" stopColor={c.accent2} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={c.chartGrid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} />
            <YAxis stroke={c.textMuted} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                background: c.tooltipBg,
                border: `1px solid ${c.tooltipBorder}`,
                borderRadius: 10,
                fontSize: 12,
                backdropFilter: 'blur(10px)',
              }}
              labelStyle={{ color: c.textDim, marginBottom: 4 }}
            />
            <Area type="monotone" dataKey="autoResolved" name="Auto-resolved" stackId="1" stroke={c.ok}      fill="url(#trend-auto)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="open"         name="In flight"     stackId="1" stroke={c.warn}    fill="url(#trend-open)" strokeWidth={1.5} />
            <Area type="monotone" dataKey="escalated"    name="Escalated"     stackId="1" stroke={c.accent2} fill="url(#trend-esc)"  strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 9, height: 9, borderRadius: 2, background: dot }} />
      {label}
    </span>
  );
}

/* ─────────────── Mini KPI (slim version) ─────────────── */

function MiniKpi({ label, value, icon: Icon, accent, sub }: {
  label: string; value: string; icon: React.ComponentType<{ size?: number }>; accent: string; sub?: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div className="kpi-icon" style={{ color: accent, background: `linear-gradient(135deg, ${accent}33, transparent)` }}>
          <Icon size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-mid">
        <div className="kpi-value">{value}</div>
      </div>
      {sub && <div className="kpi-trend-sub" style={{ fontSize: 11 }}>{sub}</div>}
    </div>
  );
}

// silence unused-import warnings for icons that read nicer to keep imported alongside
void Sparkline; void ChevronRight;
