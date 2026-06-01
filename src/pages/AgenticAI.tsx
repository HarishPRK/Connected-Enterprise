import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import {
  Activity, AlertCircle, Bot, Brain, CheckCircle2, Cpu, Eye, GitFork, Layers,
  MessageSquare, Network, RefreshCw, Search, Send, Server,
  Sparkles, Square, User, Wifi, Wrench, Zap,
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { getBaseUrl, getHealth, postChat, streamResponse, streamThoughts, type AgenticUpstream } from '../ui/agenticClient';
import { RichText } from '../ui/markdown';

/* ─────────── Smart-upstream output cleaner ───────────
 * The smart-home agent on :5005 (last three preset prompts) emits a raw token
 * stream where each token is wrapped in `|` separators and trailed by a
 * `all_tools---: [...]` debug footer. Reading that raw is unpleasant — strip
 * the noise to recover the intended prose, then optionally extract key
 * findings to surface as bullets above the response. */
function cleanSmartUpstreamText(text: string): string {
  // Step 1: nuke every `|` outright — the upstream uses them as token-frame
  // separators, never as literal content. Doing this first means downstream
  // regexes don't have to think about them.
  let out = text.replace(/\|/g, ' ');
  out = out
    // Drop trailing debug footers like `all_tools---------: [...]`.
    .replace(/\n?all_tools[-_=:].*$/gms, '')
    .replace(/\n?agents_used[-_=:].*$/gms, '')
    // Strip horizontal-rule lines (`----` etc.) used as visual dividers.
    .replace(/^[-=_]{4,}.*$/gm, '')
    // Collapse the repeated "using gpt..." debug stamps LangGraph emits
    // between steps — they add nothing to the user-visible trace.
    .replace(/(?:\busing\s+gpt\.{3}\s*){2,}/gi, 'using gpt… ')
    // Remove an unmatched leading `**` if the model started bold formatting
    // but never closed it (common token-truncation artifact).
    .replace(/^\*\*\s*/, '')
    // Drop a stray solo `**` mid-sentence with no matching open or close.
    .replace(/(^|\s)\*\*(\s|$)/g, '$1$2')
    // Collapse runs of blank lines and double spaces.
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return out;
}

/** Pull sentence- or clause-level findings out of a cleaned response so we can
 *  present them as a bullet list. Always emits at least one bullet for smart-
 *  upstream responses so the chat UI stays consistent — even a short reply
 *  reads better as a labelled bullet than a wall of prose. */
function extractKeyBullets(text: string): string[] {
  // If the cleaned text already has markdown bullets, leave it alone.
  if (/^\s*[-*•]\s+/m.test(text) || /^\s*\d+[.)]\s+/m.test(text)) return [];

  const flat = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat) return [];

  // First pass: split on sentence boundaries.
  const sentences = flat
    .split(/(?<=[.!?])\s+(?=[A-Z(`])/)
    .map((s) => s.trim())
    .filter(Boolean);

  let bullets = sentences.filter(
    (s) =>
      s.length >= 18 &&
      s.length <= 280 &&
      !/^(hi|hello|sure|here'?s|let me|i can|i will|i'?m going)/i.test(s),
  );

  // Second pass: if we only ended up with one long sentence, break it into
  // clauses on `, and` / `, with` / `, but` / `, indicating` so the user
  // still gets a scannable list.
  if (bullets.length < 2 && sentences.length === 1) {
    const clauses = sentences[0]
      .split(/,\s+(?=(?:and|with|but|indicating|so|though|while|including)\b)/i)
      .map((c) => c.replace(/^(and|with|but|indicating|so|though|while|including)\s+/i, '').trim())
      .filter((c) => c.length >= 12);
    if (clauses.length >= 2) bullets = clauses;
  }

  // Final fallback: at least emit the cleaned response as a single bullet so
  // the bullets header is always present for smart-upstream turns.
  if (bullets.length === 0 && flat.length >= 12) bullets = [flat];

  return bullets.slice(0, 6).map((b) => b.replace(/\s+/g, ' ').trim());
}

/* ─────────── Trace parser ───────────
 * LangGraph emits one log line per step in the shape `[NODE NAME] message`.
 * We turn that stream of text into structured cards: a node label, an action
 * message, and (when the message contains "|"-separated `key: value` pairs)
 * a row of value chips. */

interface TraceStep {
  id: string;
  nodeLabel: string;    // raw label, e.g. "ROUTER NODE"
  nodeKey: string;      // normalised key for icon/colour lookup, e.g. "ROUTER"
  message: string;
  fields?: { key: string; value: string }[];
}

function normalizeNodeKey(label: string): string {
  return label.replace(/\s+NODE$/i, '').replace(/[\s-]+/g, '_').toUpperCase();
}

function parseTrace(raw: string): TraceStep[] {
  const lines = raw.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim().length > 0);
  const out: TraceStep[] = [];
  for (const line of lines) {
    const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (m) {
      const [, label, rest] = m;
      let fields: { key: string; value: string }[] | undefined;
      let message = rest;
      // Detect `Key: value | Key: value | ...` pattern → render as chips.
      if (rest.includes('|') && /:\s/.test(rest)) {
        const parsed = rest
          .split('|')
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => {
            const idx = p.indexOf(':');
            if (idx > 0 && idx < 40) {
              return { key: p.slice(0, idx).trim(), value: p.slice(idx + 1).trim() };
            }
            return null;
          })
          .filter((f): f is { key: string; value: string } => f !== null);
        if (parsed.length >= 2) {
          fields = parsed;
          message = '';
        }
      }
      out.push({
        id: `s-${out.length}`,
        nodeLabel: label,
        nodeKey: normalizeNodeKey(label),
        message,
        fields,
      });
    } else if (out.length > 0) {
      // Continuation of the previous step.
      const last = out[out.length - 1];
      last.message = (last.message ? last.message + ' ' : '') + line.trim();
    } else {
      // Free-text before any structured node label.
      out.push({ id: `s-${out.length}`, nodeLabel: '', nodeKey: 'TEXT', message: line.trim() });
    }
  }
  return out;
}

/** Visual treatment per known node type. Falls back to a neutral pill when
 *  the agent emits something we don't recognise. */
const NODE_META: Record<string, { icon: React.ComponentType<LucideProps>; color: string }> = {
  ROUTER:                 { icon: GitFork,        color: '#c084fc' },
  CONNECTIVITY:           { icon: Network,        color: '#7cffd4' },
  CONNECTIVITY_ANALYSIS:  { icon: Network,        color: '#7cffd4' },
  ANALYSIS:               { icon: Brain,          color: '#67e8f9' },
  PLAN:                   { icon: Layers,         color: '#c084fc' },
  TOOL_SELECTION:         { icon: Wrench,         color: '#fbbf24' },
  TOOLS_EXECUTION:        { icon: Zap,            color: '#4ade80' },
  EXECUTION:              { icon: Zap,            color: '#4ade80' },
  RESPONSE:               { icon: MessageSquare,  color: '#ff7bd6' },
  REFLECTION:             { icon: Eye,            color: '#a78bfa' },
  THINKING:               { icon: Brain,          color: '#67e8f9' },
  SEARCH:                 { icon: Search,         color: '#67e8f9' },
  WIFI:                   { icon: Wifi,           color: '#7cffd4' },
  ERROR:                  { icon: AlertCircle,    color: '#ff5577' },
  TEXT:                   { icon: Activity,       color: 'var(--text-dim)' },
};
const DEFAULT_NODE_META = { icon: Activity, color: 'var(--accent)' };

function getNodeMeta(key: string) {
  if (NODE_META[key]) return NODE_META[key];
  // Partial fallback — e.g. "CONNECTIVITY_FINAL" maps to "CONNECTIVITY".
  for (const k of Object.keys(NODE_META)) {
    if (key.includes(k) && k !== 'TEXT') return NODE_META[k];
  }
  return DEFAULT_NODE_META;
}

interface ChatMessage {
  id: string;
  who: 'user' | 'agent';
  text: string;
  streaming?: boolean;
  tools?: string[];
  agentsUsed?: string[];
  /** Frozen snapshot of the thoughts trace for this turn (so it stays attached
   *  to the message even after the live panel is replaced by the next turn). */
  thoughts?: string;
  /** Upstream this turn was routed to — drives output cleaning + key-bullet
   *  extraction for the smart-home agent which emits noisy token frames. */
  upstream?: AgenticUpstream;
}

interface Preset {
  prompt: string;
  /** Which agentic upstream this prompt should hit. The first two go to the
   *  network agent on :5006; the last three go to the smart-home agent on
   *  :5005 (camera diagnostics + ambience scenarios). */
  upstream: AgenticUpstream;
}
const PRESETS: Preset[] = [
  // ── Network (:5006) ──
  { upstream: 'network', prompt: 'All my devices seem slow. Check for any anomaly in my network.' },
  { upstream: 'network', prompt: 'Analyze my 2.4 GHz network. Check for congestion in my network.' },
  // ── Smart-home / camera (:5005) — last 3 ──
  { upstream: 'smart',   prompt: 'How has the living room camera been performing? Check the last 15 minutes of data.' },
  { upstream: 'smart',   prompt: 'I’m hosting a party tonight. Set a vibrant and colourful ambience in the living room and backyard for an awesome party with good music.' },
  { upstream: 'smart',   prompt: 'I’m having an important meeting with the execs. Set the living room for the meeting based on today’s weather.' },
];

const newId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? (crypto as Crypto).randomUUID()
    : `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function AgenticAIPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'seed',
      who: 'agent',
      text: 'Hi — I\'m the agentic system. I plan, call tools, and route work across specialist agents. Watch the reasoning trace on the right while I work.',
    },
  ]);
  const [input, setInput]       = useState('');
  const [running, setRunning]   = useState(false);
  const [thoughts, setThoughts] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [requestId, setRequestId] = useState<string | undefined>();
  const [tools, setTools]         = useState<string[]>([]);
  const [agentsUsed, setAgentsUsed] = useState<string[]>([]);
  const [connOk, setConnOk]       = useState<'unknown' | 'ok' | 'down'>('unknown');
  const [upstreamUrl, setUpstreamUrl] = useState<string>(getBaseUrl());

  // Live-parsed reasoning steps (recomputed cheaply whenever the raw stream grows).
  // We always run the raw stream through the cleaner — pipe-frame separators
  // and `using gpt…` debug stamps are noise on both upstreams, not just smart.
  const traceSteps = useMemo(() => parseTrace(cleanSmartUpstreamText(thoughts)), [thoughts]);

  // Unique nodes in order of first appearance — for the pipeline header.
  const pipeline = useMemo(() => {
    const seen = new Set<string>();
    const nodes: { key: string; label: string }[] = [];
    for (const s of traceSteps) {
      if (s.nodeKey === 'TEXT' || seen.has(s.nodeKey)) continue;
      seen.add(s.nodeKey);
      nodes.push({ key: s.nodeKey, label: s.nodeLabel.replace(/\s+NODE$/i, '') });
    }
    return nodes;
  }, [traceSteps]);

  const currentNodeKey = traceSteps.length > 0 ? traceSteps[traceSteps.length - 1].nodeKey : null;

  const stopThoughtsRef = useRef<(() => void) | null>(null);
  const stopResponseRef = useRef<(() => void) | null>(null);

  const chatScrollRef     = useRef<HTMLDivElement | null>(null);
  const thoughtsScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll both panes as new content arrives.
  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight });
  }, [messages]);
  useEffect(() => {
    thoughtsScrollRef.current?.scrollTo({ top: thoughtsScrollRef.current.scrollHeight });
  }, [thoughts]);

  // Real upstream-health check via the Express proxy — actually verifies the
  // LangGraph service is responding, not just "something is at that IP."
  useEffect(() => {
    let cancelled = false;
    getHealth().then((h) => {
      if (cancelled) return;
      setConnOk(h.ok ? 'ok' : 'down');
      if (h.upstream) setUpstreamUrl(h.upstream);
    });
    return () => { cancelled = true; };
  }, []);

  function stopAll() {
    stopThoughtsRef.current?.();
    stopResponseRef.current?.();
    stopThoughtsRef.current = null;
    stopResponseRef.current = null;
    setRunning(false);
  }

  function newConversation() {
    stopAll();
    setMessages([messages[0]]);
    setThoughts('');
    setSessionId(undefined);
    setRequestId(undefined);
    setTools([]);
    setAgentsUsed([]);
    setInput('');
  }

  async function send(text: string, upstream: AgenticUpstream = 'network') {
    const t = text.trim();
    if (!t || running) return;

    const userId  = newId();
    const agentId = newId();
    setMessages((m) => [
      ...m,
      { id: userId,  who: 'user',  text: t },
      { id: agentId, who: 'agent', text: '', streaming: true, upstream },
    ]);
    setInput('');
    setRunning(true);
    setThoughts('');
    setTools([]);
    setAgentsUsed([]);

    let chat;
    try {
      chat = await postChat(t, { sessionId, sync: false, upstream });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((m) => m.map((x) => (
        x.id === agentId ? { ...x, text: `**Error:** ${msg}`, streaming: false } : x
      )));
      setRunning(false);
      return;
    }

    if (typeof chat.session_id === 'string') setSessionId(chat.session_id);

    // ── Sync mode (server returned the full payload up-front) ──
    if (chat.sync) {
      setMessages((m) => m.map((x) => (
        x.id === agentId
          ? {
              ...x,
              text: chat.response ?? '(no response)',
              tools: chat.tools ?? [],
              agentsUsed: chat.agents_used ?? [],
              thoughts: typeof chat.thoughts === 'string' ? chat.thoughts : undefined,
              streaming: false,
            }
          : x
      )));
      setTools(chat.tools ?? []);
      setAgentsUsed(chat.agents_used ?? []);
      if (typeof chat.thoughts === 'string') setThoughts(chat.thoughts);
      setRunning(false);
      return;
    }

    const rid = chat.request_id;
    if (typeof rid !== 'string' || !rid) {
      setMessages((m) => m.map((x) => (
        x.id === agentId
          ? { ...x, text: '**Error:** server response missing `request_id`', streaming: false }
          : x
      )));
      setRunning(false);
      return;
    }

    setRequestId(rid);
    let replyText = '';
    let liveThoughts = '';

    // ── Open SSE: agent reasoning (thoughts) ──
    stopThoughtsRef.current = streamThoughts(rid, {
      onEvent: (e) => {
        if (e.type === 'text' && e.body) {
          liveThoughts += e.body;
          setThoughts(liveThoughts);
        }
      },
      onError: (msg) => {
        liveThoughts += `\n\n[trace error] ${msg}`;
        setThoughts(liveThoughts);
      },
    }, upstream);

    // ── Open SSE: assistant response ──
    stopResponseRef.current = streamResponse(rid, {
      onEvent: (e) => {
        if (e.type === 'text' && e.body) {
          replyText += e.body;
          setMessages((m) => m.map((x) => (
            x.id === agentId ? { ...x, text: replyText, streaming: true } : x
          )));
        } else if (e.type === 'done') {
          const finalTools  = Array.isArray(e.tools) ? e.tools : [];
          const finalAgents = Array.isArray(e.agents_used) ? e.agents_used : [];
          const finalText   = typeof e.response === 'string' && e.response ? e.response : replyText;
          setMessages((m) => m.map((x) => (
            x.id === agentId
              ? {
                  ...x,
                  text: finalText || '(no response)',
                  tools: finalTools,
                  agentsUsed: finalAgents,
                  thoughts: liveThoughts,
                  streaming: false,
                }
              : x
          )));
          setTools(finalTools);
          setAgentsUsed(finalAgents);
        } else if (e.type === 'error') {
          setMessages((m) => m.map((x) => (
            x.id === agentId
              ? { ...x, text: `**Error:** ${e.message ?? 'unknown'}`, streaming: false }
              : x
          )));
        }
      },
      onError: (msg) => {
        setMessages((m) => m.map((x) => (
          x.id === agentId
            ? { ...x, text: `**Stream error:** ${msg}`, streaming: false }
            : x
        )));
      },
      onDone: () => {
        // Whichever stream finishes last clears the running state.
        setRunning(false);
      },
    }, upstream);
  }

  const turnTools = tools.length;
  const turnAgents = agentsUsed.length;

  return (
    <>
      <PageHeader
        title={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            <span className="agentic-title-orb">
              <Bot size={18} />
              <span className="agentic-title-orb-ring" />
            </span>
            Agentic AI
          </span>
        }
        subtitle="Multi-agent orchestration · live reasoning trace · tool calling · session memory"
        right={
          <div className="toolbar">
            <ConnPill state={connOk} url={upstreamUrl} />
            <button onClick={newConversation} title="Start a fresh session">
              <RefreshCw size={13} />New session
            </button>
          </div>
        }
      />

      {/* ── Capability hero strip ── */}
      <div className="agentic-hero">
        <HeroTile
          icon={Layers}
          color="var(--accent-3, #c084fc)"
          headline="Multi-agent"
          big={running && turnAgents ? String(turnAgents) : 'Orchestrated'}
          sub={running && turnAgents ? 'specialists engaged' : 'planner routes work to specialists'}
        />
        <HeroTile
          icon={Wrench}
          color="var(--warn)"
          headline="Tool calling"
          big={turnTools ? String(turnTools) : 'Live'}
          sub={turnTools ? 'tool calls this turn' : 'agent picks from its toolbelt'}
        />
        <HeroTile
          icon={Brain}
          color="var(--accent)"
          headline="Reasoning trace"
          big={running ? 'Streaming' : (thoughts ? 'Captured' : 'Idle')}
          sub={running ? 'thoughts arriving over SSE' : 'chain-of-thought visible on the right'}
          pulsing={running}
        />
        <HeroTile
          icon={Sparkles}
          color="var(--accent-2, #ec4899)"
          headline="Session memory"
          big={sessionId ? 'Active' : 'New'}
          sub={sessionId ? `id · ${sessionId.slice(0, 8)}…` : 'first turn starts a new session'}
        />
      </div>

      <div className="grid">
        {/* ── Conversation pane ── */}
        <div className="col-8">
          <Card
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Bot size={13} />Conversation
              </span>
            }
            sub={sessionId
              ? <span className="mono" style={{ fontSize: 11 }}>session · {sessionId}</span>
              : 'No session yet — your first message starts one'}
            right={running
              ? <span className="badge warn"><span className="dot warn" /> Agent running</span>
              : <span className="badge ok"><span className="dot ok" /> Idle</span>}
          >
            <div ref={chatScrollRef} className={`agentic-chat ${running ? 'is-running' : ''}`}>
              {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
            </div>

            {/* Preset prompts */}
            <div className="agentic-presets">
              <span className="agentic-preset-label"><Zap size={11} />Quick prompts</span>
              {PRESETS.map((p) => (
                <button
                  key={p.prompt}
                  className="agentic-preset"
                  onClick={() => send(p.prompt, p.upstream)}
                  disabled={running}
                  title={`${p.prompt}  ·  upstream: ${p.upstream}`}
                >
                  {p.prompt}
                </button>
              ))}
            </div>

            {/* Composer */}
            <div className={`agentic-composer ${running ? 'is-running' : ''}`}>
              <div className="agentic-composer-input">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask the agent to investigate, plan, or take an action…"
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (!running) send(input);
                    }
                  }}
                  disabled={running}
                />
                <div className="agentic-composer-hint">
                  <kbd>↵</kbd> send · <kbd>Shift</kbd>+<kbd>↵</kbd> newline
                </div>
              </div>
              {running ? (
                <button className="agentic-send is-stop" onClick={stopAll} title="Stop the agent">
                  <Square size={14} fill="currentColor" />Stop
                </button>
              ) : (
                <button
                  className="agentic-send"
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  title="Send (↵)"
                >
                  <Send size={14} />Send
                </button>
              )}
            </div>
          </Card>
        </div>

        {/* ── Live reasoning trace ── */}
        <div className="col-4">
          <Card
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Brain size={13} />Reasoning trace
              </span>
            }
            sub={running ? 'Streaming live from /thoughts/<id>' : (thoughts ? 'Last completed turn' : 'Waiting for next turn')}
            right={running && requestId
              ? <span className="badge warn mono" style={{ fontSize: 10 }}>req · {requestId.slice(0, 8)}</span>
              : undefined}
          >
            <div ref={thoughtsScrollRef} className={`agentic-trace ${running ? 'is-streaming' : ''}`}>
              {traceSteps.length === 0
                ? (
                  <div className="agentic-trace-empty">
                    <span className="agentic-brain-orb">
                      <Brain size={28} />
                      <span className="agentic-brain-pulse" />
                      <span className="agentic-brain-pulse delay" />
                    </span>
                    <div className="agentic-trace-empty-title">Reasoning will stream here</div>
                    <div className="sub">
                      Watch tool calls, plans, and inter-agent handoffs as they happen.
                    </div>
                  </div>
                )
                : (
                  <>
                    {pipeline.length > 1 && (
                      <TracePipeline pipeline={pipeline} currentKey={currentNodeKey} running={running} />
                    )}
                    <TraceSteps steps={traceSteps} streaming={running} />
                  </>
                )}
            </div>
          </Card>
        </div>

        {/* ── Tools + Agents used ── */}
        <div className="col-6">
          <Card
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Wrench size={13} />Tools used this turn
              </span>
            }
            sub={`${tools.length} tool call${tools.length === 1 ? '' : 's'}`}
            right={tools.length > 0 ? <span className="badge warn">{tools.length}</span> : undefined}
          >
            {tools.length === 0
              ? (
                <EmptyVisual
                  icon={Wrench}
                  color="var(--warn)"
                  title="No tools called yet"
                  detail="The agent picks from its toolbelt as needed — calls will appear here mid-turn."
                />
              )
              : (
                <div className="agentic-chips">
                  {tools.map((t, i) => (
                    <span key={i} className="agentic-chip agentic-chip-tool">
                      <Wrench size={11} />
                      <span className="mono">{t}</span>
                    </span>
                  ))}
                </div>
              )}
          </Card>
        </div>
        <div className="col-6">
          <Card
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <Network size={13} />Agents engaged this turn
              </span>
            }
            sub={`${agentsUsed.length} specialist${agentsUsed.length === 1 ? '' : 's'} engaged`}
            right={agentsUsed.length > 0 ? <span className="badge" style={{ color: 'var(--accent-3, #c084fc)', borderColor: 'rgba(192,132,252,0.5)' }}>{agentsUsed.length}</span> : undefined}
          >
            {agentsUsed.length === 0
              ? (
                <EmptyVisual
                  icon={Network}
                  color="var(--accent-3, #c084fc)"
                  title="No specialist agents engaged yet"
                  detail="The orchestrator routes work to specialists based on the request — they'll appear here as they're called."
                />
              )
              : (
                <div className="agentic-chips">
                  {agentsUsed.map((a, i) => (
                    <span key={i} className="agentic-chip agentic-chip-agent">
                      <Cpu size={11} />
                      {a}
                    </span>
                  ))}
                </div>
              )}
          </Card>
        </div>
      </div>
    </>
  );
}

function HeroTile({
  icon: Icon, headline, big, sub, color, pulsing,
}: {
  icon: React.ComponentType<{ size?: number }>;
  headline: string;
  big: string;
  sub: string;
  color: string;
  pulsing?: boolean;
}) {
  return (
    <div className="agentic-hero-tile" style={{ borderColor: color }}>
      <div className="agentic-hero-head">
        <span className={`agentic-hero-icon ${pulsing ? 'is-pulsing' : ''}`}
          style={{ color, background: `linear-gradient(135deg, ${color}33, transparent)` }}>
          <Icon size={14} />
        </span>
        <span className="agentic-hero-headline">{headline}</span>
      </div>
      <div className="agentic-hero-big" style={{ color }}>{big}</div>
      <div className="agentic-hero-sub">{sub}</div>
    </div>
  );
}

function EmptyVisual({
  icon: Icon, color, title, detail,
}: {
  icon: React.ComponentType<{ size?: number }>;
  color: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="agentic-empty">
      <span className="agentic-empty-orb" style={{
        color,
        background: `radial-gradient(circle, ${color}22, transparent 70%)`,
      }}>
        <Icon size={22} />
      </span>
      <div className="agentic-empty-title">{title}</div>
      <div className="agentic-empty-detail">{detail}</div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.who === 'user';

  // For smart-upstream replies, strip token-frame noise and (when the response
  // is a wall of prose with no list) lift key findings into a bullets header.
  const cleanedText = !isUser && msg.upstream === 'smart'
    ? cleanSmartUpstreamText(msg.text)
    : msg.text;
  const keyBullets = !isUser && msg.upstream === 'smart' && !msg.streaming
    ? extractKeyBullets(cleanedText)
    : [];

  return (
    <div className={`agentic-row ${isUser ? 'is-user' : 'is-agent'}`}>
      {!isUser && (
        <span className="agentic-avatar agentic-avatar-agent" aria-hidden="true">
          <Bot size={15} />
        </span>
      )}
      <div className={`agentic-msg ${isUser ? 'is-user' : 'is-agent'} ${msg.streaming ? 'is-streaming' : ''}`}>
        <div className="agentic-msg-who">
          {isUser ? 'You' : 'Agent'}
          {msg.streaming && <span className="agentic-dots"><i /><i /><i /></span>}
        </div>
        {keyBullets.length > 0 && (
          <div className="agentic-msg-keypoints">
            <div className="agentic-msg-keypoints-head">
              <Sparkles size={11} />Key points
            </div>
            <ul>
              {keyBullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        )}
        {/* Skip the prose body when bullets cover the whole reply (smart
            upstream always emits at least one bullet) — avoids duplicate text.
            Streaming state still falls through so the typing indicator shows. */}
        {(keyBullets.length === 0 || msg.streaming) && (
          <div className="agentic-msg-body">
            {!isUser
              ? <RichText text={cleanedText || (msg.streaming ? 'Thinking…' : '')} />
              : <span>{cleanedText}</span>}
          </div>
        )}
        {(msg.tools?.length || msg.agentsUsed?.length) ? (
          <div className="agentic-msg-meta">
            {msg.tools?.map((t, i) => (
              <span key={`t-${i}`} className="agentic-chip agentic-chip-tool agentic-chip-sm">
                <Wrench size={9} />
                <span className="mono">{t}</span>
              </span>
            ))}
            {msg.agentsUsed?.map((a, i) => (
              <span key={`a-${i}`} className="agentic-chip agentic-chip-agent agentic-chip-sm">
                <Cpu size={9} />{a}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {isUser && (
        <span className="agentic-avatar agentic-avatar-user" aria-hidden="true">
          <User size={15} />
        </span>
      )}
    </div>
  );
}

function TracePipeline({
  pipeline, currentKey, running,
}: {
  pipeline: { key: string; label: string }[];
  currentKey: string | null;
  running: boolean;
}) {
  return (
    <div className="trace-pipeline">
      {pipeline.map((n, i) => {
        const meta = getNodeMeta(n.key);
        const Icon = meta.icon;
        const isActive = running && n.key === currentKey;
        const isDone = !isActive && (i < pipeline.length - 1 || !running);
        return (
          <div key={n.key} className="trace-pipeline-step">
            <div
              className={`trace-pipeline-dot ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`}
              style={{ color: meta.color, borderColor: meta.color }}
              title={n.label}
            >
              {isDone ? <CheckCircle2 size={11} /> : <Icon size={11} />}
            </div>
            <span className="trace-pipeline-label" style={{ color: isActive ? meta.color : undefined }}>
              {n.label}
            </span>
            {i < pipeline.length - 1 && (
              <span
                className="trace-pipeline-connector"
                style={{ background: `linear-gradient(to right, ${meta.color}66, var(--border))` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TraceSteps({ steps, streaming }: { steps: TraceStep[]; streaming: boolean }) {
  return (
    <div className="trace-steps">
      {steps.map((s, i) => {
        const meta = getNodeMeta(s.nodeKey);
        const Icon = meta.icon;
        const isLast = i === steps.length - 1;
        const isLive = isLast && streaming;
        return (
          <div key={s.id} className={`trace-step ${isLive ? 'is-live' : ''}`}>
            <div className="trace-step-rail">
              <span
                className="trace-step-dot"
                style={{
                  background: meta.color,
                  color: '#0a0820',
                  boxShadow: `0 0 10px ${meta.color}aa`,
                }}
              >
                <Icon size={10} />
              </span>
              {!isLast && (
                <span
                  className="trace-step-line"
                  style={{ background: `linear-gradient(to bottom, ${meta.color}66, var(--border))` }}
                />
              )}
            </div>
            <div className="trace-step-body">
              {s.nodeLabel && (
                <div className="trace-step-label" style={{ color: meta.color }}>
                  {s.nodeLabel.replace(/\s+NODE$/i, '')}
                  {isLive && <span className="trace-step-live-dot" />}
                </div>
              )}
              {s.message && (
                <div className="trace-step-message">{s.message}</div>
              )}
              {s.fields && (
                <div className="trace-step-fields">
                  {s.fields.map((f, j) => (
                    <div key={j} className="trace-step-field" style={{ borderColor: `${meta.color}55` }}>
                      <span className="trace-step-field-key">{f.key}</span>
                      <span className="trace-step-field-value" style={{ color: meta.color }}>{f.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConnPill({ state, url }: { state: 'unknown' | 'ok' | 'down'; url: string }) {
  const cls = state === 'ok' ? 'ok' : state === 'down' ? 'err' : 'warn';
  const label =
    state === 'ok'   ? 'Reachable' :
    state === 'down' ? 'Unreachable' : 'Checking';
  return (
    <span className={`badge ${cls}`} title={url}>
      <Server size={11} />
      <span style={{ marginLeft: 4 }}>{label}</span>
      <span className="mono" style={{ marginLeft: 6, opacity: 0.7 }}>{url.replace(/^https?:\/\//, '')}</span>
    </span>
  );
}

