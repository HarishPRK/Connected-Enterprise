import { Send, Sparkles, Square, Wrench } from 'lucide-react';
import { Card } from '../Card';
import { useEffect, useRef, useState } from 'react';
import { runAskSSE } from '../../ui/agentClient';
import { RichText } from '../../ui/markdown';

const presets = [
  'Why did Fiber flap at 02:14?',
  'Summarize the last 24h of alerts',
  'Recommended fix for offline door lock DL-2',
  'Is 5G failover ready right now?',
];

interface Msg {
  who: 'me' | 'ai';
  text: string;
  /** Tool name currently being called for an in-flight AI message. */
  toolUsing?: string;
  /** True while we're streaming chunks into this AI bubble. */
  streaming?: boolean;
}

export function AskAiPanel({ compact = false }: { compact?: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { who: 'ai', text: 'Hi — I can analyse your gateway, traffic, and alerts. Try a preset or ask a question.' },
  ]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll the chat log when new content arrives.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  function send(text: string) {
    const t = text.trim();
    if (!t || running) return;

    const userMsg: Msg = { who: 'me', text: t };
    const aiMsg:   Msg = { who: 'ai', text: '', streaming: true };

    // Build the wire-format conversation history (drop the initial greeting and any
    // streaming/tool-using bubbles — only finalised user/AI turns go to the API).
    const historyForApi: { role: 'user' | 'assistant'; content: string }[] = [
      ...msgs
        .filter((m) => m.text.trim().length > 0 && !m.streaming)
        .slice(1) // strip the canned greeting
        .map((m) => ({ role: m.who === 'me' ? ('user' as const) : ('assistant' as const), content: m.text })),
      { role: 'user', content: t },
    ];

    setMsgs((m) => [...m, userMsg, aiMsg]);
    setInput('');
    setRunning(true);

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
                text: `Error: ${String(data.message ?? 'unknown')}`,
                streaming: false,
              };
              return copy;
            });
            setRunning(false);
          }
        },
        onError: (msg) => {
          setMsgs((m) => {
            const copy = [...m];
            copy[copy.length - 1] = { who: 'ai', text: `Error: ${msg}`, streaming: false };
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

  return (
    <Card
      title={<span><Sparkles size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Ask AI</span>}
      sub="GenAI / agentic triage for alerts and performance"
    >
      <div
        ref={scrollRef}
        style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          maxHeight: compact ? 240 : 460, overflowY: 'auto',
          paddingRight: 4,
        }}
      >
        {msgs.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.who}`}>
            {m.who === 'ai' && m.text ? <RichText text={m.text} /> : m.text}
            {m.streaming && (
              <span className="chat-cursor" aria-hidden> ▍</span>
            )}
            {m.toolUsing && m.streaming && (
              <div className="chat-tool-using">
                <Wrench size={11} /> using <code>{m.toolUsing}</code>…
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="toolbar">
        {presets.map((p) => (
          <button
            key={p}
            className="preset-chip"
            onClick={() => send(p)}
            disabled={running}
          >
            {p}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ flex: 1 }}
          placeholder={running ? 'Agent is responding…' : 'Ask about this branch...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !running) send(input); }}
          disabled={running}
        />
        {running ? (
          <button onClick={stop} title="Stop agent">
            <Square size={14} />
          </button>
        ) : (
          <button className="primary" onClick={() => send(input)} disabled={!input.trim()}>
            <Send size={14} />
          </button>
        )}
      </div>
    </Card>
  );
}
