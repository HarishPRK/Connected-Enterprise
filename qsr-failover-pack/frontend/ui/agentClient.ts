/**
 * Tiny SSE client for /api/agent/run.
 * fetch() + ReadableStream + manual SSE-frame parsing — no extra deps.
 *
 * Usage:
 *   const stop = runAgentSSE({ incident, onEvent, onError, onDone });
 *   stop(); // abort the stream
 */

export interface AgentRunRequest {
  incident: {
    id: string;
    title: string;
    branchId: string;
    severity: string;
    agentName?: string;
  };
}

export interface AgentEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface AgentRunHandlers {
  onEvent: (e: AgentEvent) => void;
  onError?: (msg: string) => void;
  onDone?: () => void;
}

export function runAgentSSE(
  req: AgentRunRequest,
  handlers: AgentRunHandlers,
): () => void {
  return _streamSSE('/api/agent/run', req, handlers);
}

export interface AskRequest {
  messages: { role: 'user' | 'assistant'; content: string }[];
}

export function runAskSSE(req: AskRequest, handlers: AgentRunHandlers): () => void {
  return _streamSSE('/api/ask', req, handlers);
}

/** Streams a Bedrock-Claude analysis of the live IPsec snapshot back to the
 *  caller via SSE `chunk` events. No request body — the server reads the
 *  current snapshot itself. */
export function runIpsecInsightSSE(handlers: AgentRunHandlers): () => void {
  return _streamSSE('/api/ipsec/insight', {}, handlers);
}

/** Generic Bedrock-Claude analysis for any page. Caller provides the topic
 *  (which picks a system prompt server-side) and a JSON payload describing
 *  the page's current state. Streams `chunk` events back. */
export function runInsightSSE(
  topic: 'it-devices' | 'ot-devices' | 'connectivity' | 'fleet' | 'app-routing',
  data: unknown,
  handlers: AgentRunHandlers,
): () => void {
  return _streamSSE('/api/insight', { topic, data }, handlers);
}

function _streamSSE(
  url: string,
  body: unknown,
  handlers: AgentRunHandlers,
): () => void {
  const ctrl = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      // An aborted request (unmount / regenerate / StrictMode remount) is
      // intentional — never surface it as an analysis error.
      if ((err as { name?: string })?.name !== 'AbortError') {
        handlers.onError?.(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    if (!res.ok || !res.body) {
      let msg = `Agent server returned ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch { /* ignore */ }
      handlers.onError?.(msg);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames are separated by \n\n
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);

          let event = 'message';
          const dataParts: string[] = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith(':')) continue;     // comment/heartbeat
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataParts.push(line.slice(6));
          }
          if (dataParts.length === 0) continue;
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(dataParts.join('\n')); } catch { /* ignore */ }
          handlers.onEvent({ event, data });
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
