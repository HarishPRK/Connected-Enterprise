/**
 * Client for the external LangGraph multi-agent service.
 *
 * Two upstreams behind same-origin Express proxies:
 *
 *   upstream='network'  -> /api/agentic/         -> AGENTIC_UPSTREAM        (default :5006)
 *   upstream='smart'    -> /api/agentic-smart/   -> AGENTIC_SMART_UPSTREAM  (default :5005)
 *
 * The network agent handles fleet / connectivity / camera diagnostics.
 * The smart-home agent handles ambience / device-control prompts.
 *
 *   POST /api/agentic{,-smart}/chat              -> forwarded JSON
 *   GET  /api/agentic{,-smart}/thoughts/<id>     -> forwarded SSE
 *   GET  /api/agentic{,-smart}/response/<id>     -> forwarded SSE
 *   GET  /api/agentic{,-smart}/health            -> upstream reachability check
 *
 * SSE frames here use single-line `data: {...}` events (one JSON object per
 * line), not the standard multi-line SSE frames — matches the reference
 * Python client.
 */

export type AgenticUpstream = 'network' | 'smart';

const BASE_URL_NETWORK = '/api/agentic';
const BASE_URL_SMART   = '/api/agentic-smart';

const PATH_CHAT = '/chat';
const PATH_RESPONSE = '/response';
const PATH_THOUGHTS = '/thoughts';
const PATH_HEALTH = '/health';

function baseFor(upstream: AgenticUpstream): string {
  return upstream === 'smart' ? BASE_URL_SMART : BASE_URL_NETWORK;
}

export interface ChatStartResponse {
  request_id?: string;
  session_id?: string;
  sync?: boolean;
  // sync=true: payload is delivered immediately
  response?: string;
  thoughts?: string;
  tools?: string[];
  agents_used?: string[];
  [k: string]: unknown;
}

export type AgenticEvent =
  | { type: 'text'; body?: string }
  | { type: 'ping' }
  | { type: 'end' }
  | { type: 'done'; response?: string; thoughts?: string; tools?: string[]; agents_used?: string[] }
  | { type: 'error'; message?: string };

export interface StreamHandlers {
  onEvent: (e: AgenticEvent) => void;
  onError?: (msg: string) => void;
  onDone?: () => void;
}

/** Same-origin proxy base for the chosen upstream. Override with
 *  VITE_AGENTIC_URL only if you really want to bypass the server proxy and
 *  hit the upstream directly (requires CORS on the upstream). */
export function getBaseUrl(upstream: AgenticUpstream = 'network'): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromEnv = (import.meta as any).env?.VITE_AGENTIC_URL;
  if (typeof fromEnv === 'string' && fromEnv) return fromEnv;
  return baseFor(upstream);
}

/** Real upstream-health check via the Express proxy. Returns the actual
 *  upstream URL so the UI can display "data path goes to X". */
export async function getHealth(upstream: AgenticUpstream = 'network'): Promise<{ ok: boolean; upstream?: string; status?: number; error?: string }> {
  try {
    const res = await fetch(`${getBaseUrl(upstream)}${PATH_HEALTH}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, ...body };
    }
    return await res.json();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** POST /chat — opens a request and returns the IDs to subscribe to. */
export async function postChat(
  message: string,
  opts: { sessionId?: string; sync?: boolean; signal?: AbortSignal; upstream?: AgenticUpstream } = {},
): Promise<ChatStartResponse> {
  const base = getBaseUrl(opts.upstream ?? 'network');
  const body: Record<string, unknown> = { message, sync: opts.sync ?? false };
  if (opts.sessionId) body.session_id = opts.sessionId;

  const res = await fetch(`${base}${PATH_CHAT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    throw new Error(`POST /chat failed (${res.status}) ${detail.slice(0, 200)}`);
  }
  return res.json();
}

/** GET /thoughts/<id> as an SSE stream — agent's live reasoning trace. */
export function streamThoughts(requestId: string, handlers: StreamHandlers, upstream: AgenticUpstream = 'network'): () => void {
  return _readGetSse(`${getBaseUrl(upstream)}${PATH_THOUGHTS}/${requestId}`, handlers);
}

/** GET /response/<id> as an SSE stream — the assistant's streamed reply. */
export function streamResponse(requestId: string, handlers: StreamHandlers, upstream: AgenticUpstream = 'network'): () => void {
  return _readGetSse(`${getBaseUrl(upstream)}${PATH_RESPONSE}/${requestId}`, handlers);
}

function _readGetSse(url: string, handlers: StreamHandlers): () => void {
  const ctrl = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal });
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        handlers.onError?.(err instanceof Error ? err.message : String(err));
      }
      handlers.onDone?.();
      return;
    }

    if (!res.ok || !res.body) {
      handlers.onError?.(`SSE server returned ${res.status}`);
      handlers.onDone?.();
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let stopped = false;

    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // Server emits one `data: {...}` JSON line per event, terminated by \n.
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trimEnd();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;

          const raw = line.slice(5).trim();
          if (!raw) continue;

          let evt: AgenticEvent;
          try {
            evt = JSON.parse(raw) as AgenticEvent;
          } catch {
            continue;
          }
          handlers.onEvent(evt);
          if (evt.type === 'end' || evt.type === 'done' || evt.type === 'error') {
            stopped = true;
            break;
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name !== 'AbortError') {
        handlers.onError?.(err instanceof Error ? err.message : String(err));
      }
    } finally {
      handlers.onDone?.();
    }
  })();

  return () => ctrl.abort();
}
