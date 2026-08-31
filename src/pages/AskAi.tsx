import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowUp, Check, ChevronRight, Copy,
  Clock3, Gauge, ListChecks, Plus, Radio, Sparkles, Square, Wrench, Zap,
} from 'lucide-react';
import { runAskSSE } from '../ui/agentClient';
import { RichText } from '../ui/markdown';
import {
  branches,
  BRANCH_TO_DEVICE_TOPIC,
  BRANCH_TO_FAILOVER_TOPIC,
  BRANCH_TO_WAN_TOPIC,
} from '../data/mock';
import { ipsecStateForTopic } from '../ui/ipsecTopicState';
import { useIpsecMetrics } from '../ui/useIpsecMetrics';

interface Msg {
  who: 'me' | 'ai';
  text: string;
  /** Tool name currently being called for an in-flight AI message. */
  toolUsing?: string;
  /** True while we're streaming chunks into this AI message. */
  streaming?: boolean;
  /** Render as an error block instead of a normal AI answer. */
  error?: boolean;
}

const suggestions = [
  {
    icon: Activity, tint: 'mint',
    title: 'Is the WAN link up, and which tunnel is active right now?',
    sub: 'Current link state and active tunnel',
  },
  {
    icon: Radio, tint: 'violet',
    title: 'Are any IPsec tunnels unreachable right now?',
    sub: 'Live tunnel presence and reachability',
  },
  {
    icon: Activity, tint: 'warn',
    title: 'What latency and packet loss is each tunnel reporting right now?',
    sub: 'Current per-tunnel latency and loss',
  },
  {
    icon: Gauge, tint: 'violet',
    title: 'What are the WAN RX and TX rates right now?',
    sub: 'Latest counter-derived directional rates',
  },
  {
    icon: Zap, tint: 'mint',
    title: 'Is the cellular backup registered and connected right now?',
    sub: 'Modem registration, bearer and radio state',
  },
  {
    icon: ListChecks, tint: 'violet',
    title: 'How many devices are healthy, degraded, or offline right now?',
    sub: 'Live inventory health counts',
  },
  {
    icon: Radio, tint: 'warn',
    title: 'Which IT or OT devices need attention right now?',
    sub: 'Status and reported device telemetry',
  },
  {
    icon: Clock3, tint: 'mint',
    title: 'How fresh is the latest telemetry for this branch?',
    sub: 'Source connection state and sample age',
  },
];

const ASK_AI_FRESH_MS = 90_000;

type TopicAvailability = 'live' | 'stale' | 'disconnected' | 'waiting' | 'not configured';

interface TopicStatus {
  availability: TopicAvailability;
  label: 'Live' | 'Stale' | 'Disconnected' | 'Waiting' | 'Not configured';
  tone: 'ok' | 'warn' | 'err' | 'off';
  detail: string;
}

function sampleAge(receivedAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - receivedAt) / 1_000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

function topicStatus(
  topic: string | undefined,
  state: { receivedAt: number } | undefined,
  connected: boolean,
  feedResponded: boolean,
  nowMs: number,
): TopicStatus {
  if (!topic) {
    return {
      availability: 'not configured',
      label: 'Not configured',
      tone: 'off',
      detail: 'No live topic mapped',
    };
  }

  if (!state) {
    if (!connected && feedResponded) {
      return {
        availability: 'disconnected',
        label: 'Disconnected',
        tone: 'err',
        detail: `${topic} · MQTT disconnected`,
      };
    }
    return {
      availability: 'waiting',
      label: 'Waiting',
      tone: 'off',
      detail: `${topic} · awaiting first sample`,
    };
  }

  const age = sampleAge(state.receivedAt, nowMs);
  if (!connected) {
    return {
      availability: 'disconnected',
      label: 'Disconnected',
      tone: 'err',
      detail: `${topic} · last sample ${age}`,
    };
  }
  if (nowMs - state.receivedAt > ASK_AI_FRESH_MS) {
    return {
      availability: 'stale',
      label: 'Stale',
      tone: 'warn',
      detail: `${topic} · last sample ${age}`,
    };
  }
  return {
    availability: 'live',
    label: 'Live',
    tone: 'ok',
    detail: `${topic} · updated ${age}`,
  };
}

const TOOL_ACTIVITY: Record<string, string> = {
  get_live_branch_wan: 'Reading live WAN and tunnel telemetry…',
  get_live_branch_devices: 'Reading live device inventory…',
};

function friendlyToolActivity(tool: string): string {
  return TOOL_ACTIVITY[tool] ?? 'Checking available telemetry…';
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < 0.01) return '<0.01 Mbps';
  return `${value.toFixed(value < 10 ? 2 : 1)} Mbps`;
}

export function AskAiPage({ branchId }: { branchId: string }) {
  return <AskAiBranchPage key={branchId} branchId={branchId} />;
}

function AskAiBranchPage({ branchId }: { branchId: string }) {
  const configuredBranch = branches.find((branch) => branch.id === branchId);
  const branchName = configuredBranch?.name ?? (branchId || 'Unknown branch');
  const branchLocation = configuredBranch?.location ?? 'Location not configured';
  const ipsec = useIpsecMetrics();
  const failoverTopic = BRANCH_TO_FAILOVER_TOPIC[branchId];
  const wanTopic = BRANCH_TO_WAN_TOPIC[branchId];
  const deviceTopic = BRANCH_TO_DEVICE_TOPIC[branchId];
  const failoverState = failoverTopic
    ? ipsecStateForTopic(ipsec.list, failoverTopic)
    : undefined;
  const deviceState = deviceTopic
    ? ipsecStateForTopic(ipsec.list, deviceTopic)
    : undefined;
  const wanState = wanTopic
    ? ipsecStateForTopic(ipsec.list, wanTopic)
    : undefined;

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const stopRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // Only auto-follow the stream while the user is already near the bottom —
  // scrolling up to re-read must not be fought by incoming chunks.
  const nearBottomRef = useRef(true);

  const hasThread = msgs.length > 0;
  const feedResponded = ipsec.lastReceivedAt != null || ipsec.lastError != null;
  const failoverStatus = topicStatus(
    failoverTopic,
    failoverState,
    ipsec.connected,
    feedResponded,
    nowMs,
  );
  const deviceStatus = topicStatus(
    deviceTopic,
    deviceState,
    ipsec.connected,
    feedResponded,
    nowMs,
  );
  const wanStatus = topicStatus(
    wanTopic,
    wanState,
    ipsec.connected,
    feedResponded,
    nowMs,
  );
  const statuses = [failoverStatus, wanStatus, deviceStatus];
  const footerTone = statuses.some((status) => status.tone === 'err')
    ? 'err'
    : statuses.some((status) => status.tone === 'warn')
      ? 'warn'
      : statuses.every((status) => status.tone === 'ok')
        ? 'ok'
        : 'off';
  const liveGateway = failoverStatus.availability === 'live'
    ? failoverState?.metrics.gateway.name || 'Not reported'
    : failoverStatus.label;
  const activeTunnel = failoverStatus.availability === 'live' && failoverState
    ? failoverState.metrics.active_tunnel || 'None reported'
    : failoverStatus.label;
  const wifiClients = deviceStatus.availability === 'live'
    && typeof deviceState?.metrics.wifi?.active_clients === 'number'
    ? `${deviceState.metrics.wifi.active_clients} connected`
    : deviceStatus.availability === 'live'
      ? 'Not reported'
      : deviceStatus.label;
  const wanRates = wanStatus.availability === 'live' && wanState?.wanRate
    ? `${formatRate(wanState.wanRate.rxMbps)} RX · ${formatRate(wanState.wanRate.txMbps)} TX`
    : wanStatus.availability === 'live'
      ? 'Warming up'
      : wanStatus.label;

  useEffect(() => {
    if (!hasThread) return;
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [hasThread, msgs]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => stopRef.current?.(), []);

  function onThreadScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }

  function autoGrow() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || running) return;

    const userMsg: Msg = { who: 'me', text: t };
    const aiMsg:   Msg = { who: 'ai', text: '', streaming: true };

    // Wire-format history: only finalised, non-error turns go to the API.
    const historyForApi: { role: 'user' | 'assistant'; content: string }[] = [
      ...msgs
        .filter((m) => m.text.trim().length > 0 && !m.streaming && !m.error)
        .map((m) => ({ role: m.who === 'me' ? ('user' as const) : ('assistant' as const), content: m.text })),
      { role: 'user', content: t },
    ];

    setMsgs((m) => [...m, userMsg, aiMsg]);
    setInput('');
    setRunning(true);
    nearBottomRef.current = true;
    requestAnimationFrame(autoGrow);

    let aiText = '';

    stopRef.current = runAskSSE(
      { branchId, messages: historyForApi },
      {
        onEvent: ({ event, data }) => {
          if (event === 'chunk') {
            aiText += String(data.text ?? '');
            setMsgs((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { who: 'ai', text: aiText, streaming: true };
              return copy;
            });
          } else if (event === 'tool_using') {
            const tool = String(data.tool ?? '');
            setMsgs((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { ...copy[copy.length - 1], toolUsing: tool };
              return copy;
            });
          } else if (event === 'done') {
            setMsgs((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                who: 'ai',
                text: aiText || '(no response)',
                streaming: false,
              };
              return copy;
            });
            setRunning(false);
          } else if (event === 'error') {
            setMsgs((m) => {
              const copy = [...m];
              copy[copy.length - 1] = {
                who: 'ai',
                text: String(data.message ?? 'unknown'),
                streaming: false,
                error: true,
              };
              return copy;
            });
            setRunning(false);
          }
        },
        onError: (msg) => {
          setMsgs((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { who: 'ai', text: msg, streaming: false, error: true };
            return copy;
          });
          setRunning(false);
        },
        onDone: () => setRunning(false),
      },
    );
  }

  function stop() {
    stopRef.current?.();
    stopRef.current = null;
    setRunning(false);
    setMsgs((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last && last.who === 'ai' && last.streaming) {
        copy[copy.length - 1] = {
          who: 'ai',
          text: last.text || '(stopped)',
          streaming: false,
        };
      }
      return copy;
    });
  }

  function newChat() {
    if (running) stop();
    setMsgs([]);
    setInput('');
    nearBottomRef.current = true;
    requestAnimationFrame(() => taRef.current?.focus());
  }

  async function copyMsg(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1600);
    } catch { /* clipboard unavailable — ignore */ }
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!running) send(input);
    } else if (e.key === 'Escape' && running) {
      stop();
    }
  }

  return (
    <div className="askai-page">
      <section className="askai-chat">
        {hasThread && (
          <div className="askai-chat-head">
            <div className="askai-chat-title">
              <span className="askai-avatar sm"><Sparkles size={12} /></span>
              Ask AI
              <span className="badge">Read-only</span>
            </div>
            <button className="askai-newchat" onClick={newChat}>
              <Plus size={14} /> New chat
            </button>
          </div>
        )}

        <div className="askai-thread" ref={scrollRef} onScroll={onThreadScroll}>
          {hasThread ? (
            <div className="askai-thread-inner">
              {msgs.map((m, i) =>
                m.who === 'me' ? (
                  <div key={i} className="askai-msg me">
                    <div className="askai-bubble">{m.text}</div>
                  </div>
                ) : (
                  <div key={i} className="askai-msg ai">
                    <span className={`askai-avatar${m.streaming ? ' live' : ''}`}>
                      <Sparkles size={14} />
                    </span>
                    <div className="askai-msg-main">
                      {m.error ? (
                        <div className="askai-error">
                          <strong>Something went wrong.</strong> {m.text}
                        </div>
                      ) : m.text ? (
                        <div className="askai-msg-body">
                          <RichText text={m.text} />
                          {m.streaming && <span className="askai-caret" aria-hidden />}
                        </div>
                      ) : (
                        <div className="askai-thinking" aria-label="Analyzing">
                          <span /><span /><span />
                        </div>
                      )}
                      {m.toolUsing && m.streaming && (
                        <div className="askai-tool">
                          <Wrench size={12} /> {friendlyToolActivity(m.toolUsing)}
                        </div>
                      )}
                      {!m.streaming && !m.error && m.text && (
                        <div className="askai-msg-actions">
                          <button
                            className="askai-action"
                            onClick={() => copyMsg(i, m.text)}
                            title="Copy response"
                          >
                            {copied === i ? <Check size={13} /> : <Copy size={13} />}
                            {copied === i ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="askai-hero">
              <div className="askai-orb"><Sparkles size={26} /></div>
              <h1 className="askai-hero-title">
                How can I help with <span className="askai-hero-branch">{branchName.replaceAll('-', '\u2011')}</span>?
              </h1>
              <p className="askai-hero-sub">
                Read-only analysis using available live WAN, tunnel, cellular and connected-device telemetry.
              </p>
              <div className="askai-suggest-grid">
                {suggestions.map((s) => (
                  <button key={s.title} className="askai-suggest" onClick={() => send(s.title)}>
                    <span className={`askai-suggest-icon ${s.tint}`}><s.icon size={17} /></span>
                    <span className="askai-suggest-text">
                      <span className="askai-suggest-title">{s.title}</span>
                      <span className="askai-suggest-sub">{s.sub}</span>
                    </span>
                    <ChevronRight size={15} className="askai-suggest-go" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="askai-composer-zone">
          <div className={`askai-composer${running ? ' running' : ''}`}>
            <textarea
              ref={taRef}
              className="askai-input"
              rows={1}
              placeholder={running
                ? 'Ask a follow-up…'
                : 'Ask about WAN, tunnels, cellular backup, or connected devices…'}
              value={input}
              onChange={(e) => { setInput(e.target.value); autoGrow(); }}
              onKeyDown={onComposerKey}
            />
            {running ? (
              <button className="askai-send stop" onClick={stop} title="Stop (Esc)">
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button
                className="askai-send"
                onClick={() => send(input)}
                disabled={!input.trim()}
                title="Send (Enter)"
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
          <div className="askai-footnote">
            <span className="askai-footnote-ctx">
              <span className={`dot ${footerTone}`} /> {branchName} · WAN {wanStatus.label.toLowerCase()} · devices {deviceStatus.label.toLowerCase()}
            </span>
            <span>Read-only AI analysis · confirm against source telemetry</span>
          </div>
        </div>
      </section>

      <aside className="askai-rail">
        <div className="askai-rail-card">
          <div className="askai-rail-head">
            <span className="askai-rail-title"><Activity size={13} /> Selected branch</span>
            <span className="badge">Read-only</span>
          </div>

          <div className="askai-rail-branch">
            <div className="askai-rail-branch-name">{branchName}</div>
            <div className="askai-rail-branch-loc">{branchLocation}</div>
            <div className="askai-facts">
              <div className="askai-fact">
                <span className="askai-fact-k">Gateway</span>
                <span className="askai-fact-v">{liveGateway}</span>
              </div>
              <div className="askai-fact">
                <span className="askai-fact-k">Active tunnel</span>
                <span className="askai-fact-v">{activeTunnel}</span>
              </div>
              <div className="askai-fact">
                <span className="askai-fact-k">Wi-Fi clients</span>
                <span className="askai-fact-v">{wifiClients}</span>
              </div>
              <div className="askai-fact">
                <span className="askai-fact-k">WAN RX / TX</span>
                <span className="askai-fact-v">{wanRates}</span>
              </div>
            </div>
          </div>

          <div className="askai-rail-sec">Live data sources</div>
          <div className="askai-rail-alerts">
            {[
              { name: 'Tunnels & failover', topic: failoverTopic, status: failoverStatus },
              { name: 'WAN RX / TX', topic: wanTopic, status: wanStatus },
              { name: 'Device inventory', topic: deviceTopic, status: deviceStatus },
            ].map((source) => (
              <div className="askai-rail-alert" key={source.name}>
                <span className={`dot ${source.status.tone}`} />
                <span className="askai-rail-alert-main">
                  <span className="askai-rail-alert-title">{source.name}</span>
                  <span className="askai-rail-alert-meta" title={source.topic}>
                    {source.status.detail}
                  </span>
                </span>
                <span className={`badge ${source.status.tone === 'off' ? '' : source.status.tone}`}>
                  {source.status.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
