/**
 * OpsIncidentsProvider — derives *real* operational incidents from the live
 * IPsec failover telemetry and exposes them to the Incidents page.
 *
 * It subscribes to the IPsec stream once (globally, via useIpsecMetrics) so
 * incidents are detected even when the user isn't on the Dynamic Failover page.
 * Conditions are debounced (open after N consecutive detections, auto-resolve
 * after N consecutive recoveries) so the inbox doesn't flap.
 *
 * Detected conditions (scope-limited per product decision):
 *   • Gateway telemetry stale — no payload for STALE_MS (skew-immune: measured
 *     from the client-side time we last saw `receivedAt` advance).            [high]
 *   • Underlay down — every tunnel in an underlay unreachable.                [high]
 *   • Tunnel unreachable — a single tunnel present but failing probes.        [medium]
 *   • Active-path SLA breach — active tunnel over latency/loss/MOS bounds.    [medium]
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useIpsecMetrics } from './useIpsecMetrics';
import { BRANCH_TO_IPSEC_SOURCE, branches } from '../data/mock';
import type {
  AgentStep,
  Incident,
  IncidentSeverity,
  IpsecGatewayState,
} from '../types';

const STALE_MS = 90_000; // no payload for 90s ⇒ stale (device publishes ~10s)
const OPEN_AFTER = 2; // consecutive detections before opening (debounce)
const CLOSE_AFTER = 2; // consecutive recoveries before auto-resolving
const TICK_MS = 5_000;

interface OpsIncidentsValue {
  liveIncidents: Incident[];
  patchIncident: (id: string, patch: Partial<Incident>) => void;
  appendStep: (id: string, step: AgentStep) => void;
  openCount: number;
}

const Ctx = createContext<OpsIncidentsValue | null>(null);

/* ── small local helpers (kept independent of the Failover page) ── */
function inferUnderlay(ifname: string): 'fiber' | '5g' {
  const n = (ifname || '').toLowerCase();
  return n.includes('cell') || n.includes('5g') || n.includes('lte') || n.includes('wwan')
    ? '5g'
    : 'fiber';
}
function approxMos(latencyMs: number, lossPercent: number): number {
  if (latencyMs <= 0) return 0;
  const latPenalty = 0.024 * latencyMs + Math.max(0, 0.11 * (latencyMs - 177.3));
  const R = Math.max(0, Math.min(100, 93.2 - latPenalty - 2.5 * lossPercent));
  return Math.max(1, Math.min(5, 1 + 0.035 * R + 7e-6 * R * (R - 60) * (100 - R)));
}
function prettyName(raw: string): string {
  const name = (raw || '').trim();
  if (!name) return 'Gateway';
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((t) => (/\d/.test(t) || t.length <= 3 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1)))
    .join(' ');
}
function sourceToBranch(source: string): string {
  const b = Object.keys(BRANCH_TO_IPSEC_SOURCE).find((k) => BRANCH_TO_IPSEC_SOURCE[k] === source);
  return b ?? branches[0]?.id ?? '';
}

interface Cond {
  key: string;
  severity: IncidentSeverity;
  title: string;
  evidence: string;
  branchId: string;
}

/** Evaluate every gateway's current conditions into a flat list. */
function detect(
  list: IpsecGatewayState[],
  lastSeen: Record<string, number>,
  now: number,
): Cond[] {
  const conds: Cond[] = [];
  for (const g of list) {
    const gname = g.metrics.gateway.name || 'gateway';
    const pretty = prettyName(gname);
    const branchId = sourceToBranch(g.source ?? 'rdk');

    // Stale — measured from when WE last saw a fresh payload (skew-immune).
    const seen = lastSeen[gname];
    if (seen != null && now - seen > STALE_MS) {
      const mins = Math.floor((now - seen) / 60_000);
      conds.push({
        key: `${gname}|stale`,
        severity: 'high',
        title: `${pretty} telemetry stale`,
        evidence: `No IPsec payload received for ~${mins < 1 ? '<1' : mins} min. The gateway's publisher may be down or the device offline.`,
        branchId,
      });
      continue; // stale data ⇒ don't raise health alarms off old metrics
    }

    const tunnels = g.metrics.tunnels;
    const fiber = tunnels.filter((t) => inferUnderlay(t.ifname) === 'fiber');
    const cell = tunnels.filter((t) => inferUnderlay(t.ifname) === '5g');
    const fiberDown = fiber.length > 0 && fiber.every((t) => t.present && !t.reachable);
    const cellDown = cell.length > 0 && cell.every((t) => t.present && !t.reachable);

    if (fiberDown)
      conds.push({
        key: `${gname}|underlay|fiber`,
        severity: 'high',
        title: `Fiber underlay down — ${pretty}`,
        evidence: `All ${fiber.length} Fiber tunnels unreachable (${fiber.map((t) => t.ifname).join(', ')}).`,
        branchId,
      });
    if (cellDown)
      conds.push({
        key: `${gname}|underlay|5g`,
        severity: 'high',
        title: `5G underlay down — ${pretty}`,
        evidence: `All ${cell.length} 5G tunnels unreachable (${cell.map((t) => t.ifname).join(', ')}).`,
        branchId,
      });

    // Per-tunnel down — skipped where the whole underlay is already flagged.
    for (const t of tunnels) {
      if (!t.present || t.reachable) continue;
      const u = inferUnderlay(t.ifname);
      if ((u === 'fiber' && fiberDown) || (u === '5g' && cellDown)) continue;
      conds.push({
        key: `${gname}|tunnel|${t.ifname}`,
        severity: 'medium',
        title: `Tunnel ${t.ifname} unreachable`,
        evidence: `${t.ifname} (${u === 'fiber' ? 'Fiber' : '5G'}) is present but failing health probes.`,
        branchId,
      });
    }

    // Active-path SLA breach.
    const act = tunnels.find((t) => t.ifname === (g.metrics.active_tunnel ?? '').trim());
    if (act && act.reachable && act.latency_ms > 0) {
      const mos = approxMos(act.latency_ms, act.loss_percent);
      const reasons: string[] = [];
      if (act.latency_ms > 150) reasons.push(`latency ${act.latency_ms.toFixed(0)} ms`);
      if (act.loss_percent > 3) reasons.push(`loss ${act.loss_percent.toFixed(1)}%`);
      if (mos < 3.6) reasons.push(`MOS ${mos.toFixed(1)}`);
      if (reasons.length)
        conds.push({
          key: `${gname}|sla|${act.ifname}`,
          severity: 'medium',
          title: `Active-path SLA breach — ${act.ifname}`,
          evidence: `Active tunnel ${act.ifname} is breaching SLA: ${reasons.join(', ')}.`,
          branchId,
        });
    }
  }
  return conds;
}

function makeIncident(id: string, cond: Cond, now: number): Incident {
  return {
    id,
    title: cond.title,
    branchId: cond.branchId,
    severity: cond.severity,
    status: 'triaging',
    assignee: 'agent',
    agentName: 'Network Specialist',
    createdISO: new Date(now).toISOString(),
    confidence: 0.82,
    steps: [
      {
        id: `sys-${id}`,
        ts: 0,
        kind: 'system',
        content: `Auto-detected from live IPsec failover telemetry. ${cond.evidence}`,
      },
      {
        id: `sys2-${id}`,
        ts: 1000,
        kind: 'system',
        content:
          'Raised by the Dynamic Failover monitor. Run the live Claude agent to investigate, or resolve / escalate manually. Auto-resolves when telemetry recovers.',
      },
    ],
  };
}

export function OpsIncidentsProvider({ children }: { children: ReactNode }) {
  const ipsec = useIpsecMetrics();
  const listRef = useRef<IpsecGatewayState[]>(ipsec.list);
  listRef.current = ipsec.list;

  const lastSeenRef = useRef<Record<string, number>>({}); // gateway → client ts of last fresh payload
  const lastRcvRef = useRef<Record<string, number>>({}); // gateway → last receivedAt value
  const openRef = useRef<Record<string, string>>({}); // condKey → incident id
  const upRef = useRef<Record<string, number>>({}); // condKey → consecutive detections
  const downRef = useRef<Record<string, number>>({}); // condKey → consecutive recoveries
  const seqRef = useRef(1);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  // Stamp the client-side time whenever a gateway's payload advances — this is
  // what staleness is measured against (immune to server/client clock skew).
  useEffect(() => {
    const now = Date.now();
    for (const g of ipsec.list) {
      const gname = g.metrics.gateway.name || 'gateway';
      if (lastRcvRef.current[gname] !== g.receivedAt) {
        lastRcvRef.current[gname] = g.receivedAt;
        lastSeenRef.current[gname] = now;
      }
    }
  }, [ipsec.list]);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const conds = detect(listRef.current, lastSeenRef.current, now);
      const active = new Map(conds.map((c) => [c.key, c]));

      // Open: debounce so a one-sample blip doesn't spawn an incident.
      for (const [key, cond] of active) {
        downRef.current[key] = 0;
        if (openRef.current[key]) continue;
        upRef.current[key] = (upRef.current[key] ?? 0) + 1;
        if (upRef.current[key] >= OPEN_AFTER) {
          const id = `INC-LIVE-${String(seqRef.current++).padStart(3, '0')}`;
          openRef.current[key] = id;
          setIncidents((prev) => [makeIncident(id, cond, now), ...prev]);
        }
      }
      // Reset the open-debounce for conditions that aren't currently active.
      for (const key of Object.keys(upRef.current)) {
        if (!active.has(key) && !openRef.current[key]) upRef.current[key] = 0;
      }
      // Auto-resolve: condition cleared for CLOSE_AFTER consecutive ticks.
      for (const key of Object.keys(openRef.current)) {
        if (active.has(key)) continue;
        downRef.current[key] = (downRef.current[key] ?? 0) + 1;
        if (downRef.current[key] >= CLOSE_AFTER) {
          const id = openRef.current[key];
          delete openRef.current[key];
          delete upRef.current[key];
          delete downRef.current[key];
          setIncidents((prev) =>
            prev.map((i) =>
              i.id === id && i.status !== 'resolved' && i.status !== 'escalated'
                ? {
                    ...i,
                    status: 'resolved',
                    resolvedISO: new Date().toISOString(),
                    steps: [
                      ...i.steps,
                      {
                        id: `auto-resolve-${id}`,
                        ts: 0,
                        kind: 'resolution',
                        content:
                          'Condition cleared — telemetry recovered within SLA. Incident auto-resolved.',
                      },
                    ],
                  }
                : i,
            ),
          );
        }
      }
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const patchIncident = useCallback((id: string, patch: Partial<Incident>) => {
    setIncidents((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);
  const appendStep = useCallback((id: string, step: AgentStep) => {
    setIncidents((prev) =>
      prev.map((i) => (i.id === id ? { ...i, steps: [...i.steps, step] } : i)),
    );
  }, []);

  const openCount = incidents.filter(
    (i) => i.status !== 'resolved' && i.status !== 'escalated',
  ).length;

  const value = useMemo<OpsIncidentsValue>(
    () => ({ liveIncidents: incidents, patchIncident, appendStep, openCount }),
    [incidents, patchIncident, appendStep, openCount],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOpsIncidents(): OpsIncidentsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOpsIncidents must be used inside OpsIncidentsProvider');
  return ctx;
}
