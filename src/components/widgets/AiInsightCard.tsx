import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '../Card';
import { Loader2, Sparkles } from 'lucide-react';
import { useThemeColors } from '../../ui/Theme';
import { runInsightSSE } from '../../ui/agentClient';
import { RichText } from '../../ui/markdown';

type Topic = 'it-devices' | 'ot-devices' | 'connectivity' | 'fleet' | 'app-routing';

/* ───── Shared AI Insight card ─────
 * Same visual language as the DPS page's IPsec insight card, but generic:
 * caller provides a `topic` (picks a server-side system prompt) and a `data`
 * payload describing the page's current state. The card auto-fires once on
 * first render and exposes a Regenerate button. */
export function AiInsightCard({
  topic,
  data,
  title = 'AI Insight',
  subtitle = 'Bedrock-powered analysis of this page',
  autoRun = true,
}: {
  topic: Topic;
  data: unknown;
  title?: string;
  subtitle?: string;
  autoRun?: boolean;
}) {
  const c = useThemeColors();
  const [text, setText]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const stopRef  = useRef<(() => void) | null>(null);
  const runIdRef = useRef(0);
  // Read the latest page data at generation time without making `generate`
  // change identity every render (which would re-fire the stream constantly).
  const dataRef  = useRef(data);
  dataRef.current = data;

  const generate = useCallback(() => {
    stopRef.current?.();
    const myRun = ++runIdRef.current;
    setText('');
    setError(null);
    setLoading(true);
    setLastRunAt(Date.now());
    stopRef.current = runInsightSSE(topic, dataRef.current, {
      onEvent: (e) => {
        if (myRun !== runIdRef.current) return; // ignore a superseded run
        if (e.event === 'chunk' && typeof e.data.text === 'string') {
          setText((t) => t + (e.data.text as string));
        } else if (e.event === 'error' && typeof e.data.message === 'string') {
          setError(e.data.message as string);
          setLoading(false);
        }
      },
      onError: (msg) => { if (myRun === runIdRef.current) { setError(msg); setLoading(false); } },
      onDone:  () => { if (myRun === runIdRef.current) setLoading(false); },
    });
  }, [topic]);

  // Auto-fire on mount. The cleanup aborts the stream, so a StrictMode remount
  // (or future re-mount) re-fires cleanly instead of leaving the only run
  // aborted. `generate` is stable (data is read via a ref), so this runs once
  // per mount — not on every data change.
  useEffect(() => {
    if (!autoRun) return;
    generate();
    return () => stopRef.current?.();
  }, [autoRun, generate]);

  const agoLabel = (() => {
    if (!lastRunAt) return null;
    const sec = Math.max(1, Math.round((Date.now() - lastRunAt) / 1000));
    if (sec < 60)   return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60)   return `${min}m ago`;
    return `${Math.round(min / 60)}h ago`;
  })();

  return (
    <Card
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={13} style={{ color: c.accent3 }} />
          {title}
        </span>
      }
      sub={lastRunAt
        ? <span>{subtitle} · last run {agoLabel}</span>
        : subtitle}
      right={
        <button
          onClick={generate}
          disabled={loading}
          style={loading
            ? { background: 'var(--panel-2)', color: 'var(--text-muted)' }
            : { background: 'var(--grad-accent-soft)', borderColor: 'var(--accent)', color: 'var(--text)' }}
        >
          {loading
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={13} className="spin" />Analyzing…
              </span>
            : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={13} />Regenerate
              </span>}
        </button>
      }
    >
      <div style={{
        background: 'linear-gradient(180deg, rgba(192,132,252,0.04), transparent 60%), var(--panel-2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        minHeight: 120,
        fontSize: 13,
        lineHeight: 1.55,
        color: 'var(--text-dim)',
      }}>
        {error ? (
          <div style={{ color: c.err, fontSize: 12.5 }}>
            <strong>Couldn't generate analysis:</strong> {error}
          </div>
        ) : text ? (
          <RichText text={text} />
        ) : loading ? (
          <div style={{ color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={13} className="spin" />
            Reading the current page state…
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>
            Click <strong style={{ color: 'var(--text)' }}>Regenerate</strong> to analyse the data on this page.
          </div>
        )}
      </div>
    </Card>
  );
}
