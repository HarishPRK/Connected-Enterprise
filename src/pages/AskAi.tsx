import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowUp, Check, ChevronRight, Copy, ListChecks, Lock,
  Plus, Radio, Sparkles, Square, Wrench, Zap,
} from 'lucide-react';
import { runAskSSE } from '../ui/agentClient';
import { RichText } from '../ui/markdown';
import { alerts, branches } from '../data/mock';

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
    icon: Zap, tint: 'warn',
    title: 'Why did Fiber flap at 02:14?',
    sub: 'Root-cause the overnight link event',
  },
  {
    icon: ListChecks, tint: 'mint',
    title: 'Summarize the last 24h of alerts',
    sub: 'One digest of everything that fired',
  },
  {
    icon: Lock, tint: 'rose',
    title: 'Recommended fix for offline door lock DL-2',
    sub: 'Guided remediation for the server-room lock',
  },
  {
    icon: Radio, tint: 'violet',
    title: 'Is 5G failover ready right now?',
    sub: 'Validate the standby path end-to-end',
  },
];

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function AskAiPage({ branchId }: { branchId: string }) {
  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const activeAlerts = alerts.filter((a) => a.level !== 'ok');

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // Only auto-follow the stream while the user is already near the bottom —
  // scrolling up to re-read must not be fought by incoming chunks.
  const nearBottomRef = useRef(true);

  const hasThread = msgs.length > 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

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
      { messages: historyForApi },
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
              <span className="badge">Agentic</span>
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
                          <Wrench size={12} /> querying <code>{m.toolUsing}</code>
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
                How can I help with <span className="askai-hero-branch">{branch.name}</span>?
              </h1>
              <p className="askai-hero-sub">
                Agentic triage over live gateway telemetry, traffic paths, alerts and connected devices.
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
              placeholder={running ? 'Ask a follow-up…' : `Ask anything about ${branch.name}…`}
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
              <span className="dot ok" /> {branch.name} · {branch.gatewayModel} · live telemetry
            </span>
            <span>AI-generated — verify before applying changes</span>
          </div>
        </div>
      </section>

      <aside className="askai-rail">
        <div className="askai-rail-card">
          <div className="askai-rail-head">
            <span className="askai-rail-title"><Activity size={13} /> Branch context</span>
            <span className="askai-live"><span className="dot ok" /> Live</span>
          </div>

          <div className="askai-rail-branch">
            <div className="askai-rail-branch-name">{branch.name}</div>
            <div className="askai-rail-branch-loc">{branch.location}</div>
            <div className="askai-facts">
              <div className="askai-fact">
                <span className="askai-fact-k">Gateway</span>
                <span className="askai-fact-v">{branch.gatewayModel}</span>
              </div>
              <div className="askai-fact">
                <span className="askai-fact-k">Firmware</span>
                <span className="askai-fact-v">{branch.firmware}</span>
              </div>
              <div className="askai-fact">
                <span className="askai-fact-k">Uptime</span>
                <span className="askai-fact-v">{Math.floor(branch.uptimeHours / 24)}d {branch.uptimeHours % 24}h</span>
              </div>
              <div className="askai-fact">
                <span className="askai-fact-k">Alerts</span>
                <span className="askai-fact-v">{activeAlerts.length} active</span>
              </div>
            </div>
          </div>

          <div className="askai-rail-sec">Active alerts — tap to triage</div>
          <div className="askai-rail-alerts">
            {activeAlerts.map((a) => (
              <button
                key={a.id}
                className="askai-rail-alert"
                disabled={running}
                onClick={() => send(`Diagnose alert "${a.title}" — ${a.detail}. What happened and what's the recommended fix?`)}
              >
                <span className={`dot ${a.level}`} />
                <span className="askai-rail-alert-main">
                  <span className="askai-rail-alert-title">{a.title}</span>
                  <span className="askai-rail-alert-meta">{a.detail} · {timeAgo(a.whenISO)}</span>
                </span>
                <ChevronRight size={14} className="askai-rail-alert-go" />
              </button>
            ))}
          </div>

          <button
            className="askai-triage"
            disabled={running}
            onClick={() => send('Triage all active alerts on this branch: prioritise by impact, root-cause each one, and give me a remediation plan.')}
          >
            <Sparkles size={14} /> Triage all alerts
          </button>
        </div>
      </aside>
    </div>
  );
}
