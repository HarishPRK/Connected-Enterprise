import type { Incident, IncidentStatus } from '../types';

export interface SavedIncidentFilter { id: string; name: string; query: string; status: IncidentStatus | 'all' }
export interface RunbookDraft { id: string; title: string; steps: string; updatedAt: string }
const STATUSES = ['all', 'triaging', 'investigating', 'awaiting_approval', 'resolving', 'resolved', 'escalated'];

export function loadIncidentFilters(): SavedIncidentFilter[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem('ce-incident-filters-v1') ?? '[]');
    return Array.isArray(data) ? data.filter((v): v is SavedIncidentFilter => !!v && typeof v.id === 'string' && typeof v.name === 'string' && typeof v.query === 'string' && STATUSES.includes(v.status)) : [];
  } catch { return []; }
}
export function loadRunbooks(): RunbookDraft[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem('ce-runbooks-v1') ?? '[]');
    return Array.isArray(data) ? data.filter((v): v is RunbookDraft => !!v && typeof v.id === 'string' && typeof v.title === 'string' && typeof v.steps === 'string' && typeof v.updatedAt === 'string') : [];
  } catch { return []; }
}
export function loadIncidentDecisions(seed: Incident[]): Incident[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem('ce-incident-decisions-v1') ?? '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return seed;
    return seed.map((incident) => {
      const decision = (data as Record<string, { status?: string; assignee?: string }>)[incident.id];
      if (decision?.status === 'escalated' && typeof decision.assignee === 'string') return { ...incident, status: 'escalated', assignee: decision.assignee, pendingAction: undefined };
      return incident;
    });
  } catch { return seed; }
}
export function saveIncidentDecision(id: string, assignee: string): void {
  let data: Record<string, unknown> = {};
  try {
    const saved: unknown = JSON.parse(localStorage.getItem('ce-incident-decisions-v1') ?? '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) data = saved as Record<string, unknown>;
  } catch { /* replace malformed data */ }
  localStorage.setItem('ce-incident-decisions-v1', JSON.stringify({ ...data, [id]: { status: 'escalated', assignee } }));
}
