import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, XCircle, Info, Siren, X } from 'lucide-react';
import './Toast.css';

type ToastKind = 'success' | 'warn' | 'error' | 'info' | 'critical';
interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
  durationMs?: number;
  dedupeKey?: string;
}

interface ToastCtx {
  push: (t: Omit<Toast, 'id'>) => void;
}
const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}

const iconFor = {
  success: CheckCircle2,
  warn: AlertTriangle,
  error: XCircle,
  info: Info,
  critical: Siren,
};
const colorFor: Record<ToastKind, string> = {
  success: 'var(--ok)',
  warn: 'var(--warn)',
  error: 'var(--err)',
  info: 'var(--accent)',
  critical: 'var(--err)',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const [fullscreenHost, setFullscreenHost] = useState<Element | null>(null);

  // Only descendants of the fullscreen element are painted in the browser's
  // top layer. Portal notifications into that element so a safety alert stays
  // visible while an operator is watching a feed fullscreen.
  useEffect(() => {
    const syncFullscreenHost = () => setFullscreenHost(document.fullscreenElement);
    syncFullscreenHost();
    document.addEventListener('fullscreenchange', syncFullscreenHost);
    return () => document.removeEventListener('fullscreenchange', syncFullscreenHost);
  }, []);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((items) => [
      ...items.filter((item) => !t.dedupeKey || item.dedupeKey !== t.dedupeKey),
      { id, ...t },
    ].slice(-5));
    const durationMs = t.durationMs ?? (t.kind === 'critical' ? 10_000 : 4_200);
    setTimeout(() => setItems((items) => items.filter((item) => item.id !== id)), durationMs);
  }, []);

  const toastStack = (
    <div className="toast-stack" aria-live="polite">
        {items.map((t) => {
          const Icon = iconFor[t.kind];
          const style = { '--toast-tone': colorFor[t.kind] } as CSSProperties;
          return (
            <div
              key={t.id}
              className={`toast toast--${t.kind}`}
              style={style}
              role={t.kind === 'critical' || t.kind === 'error' ? 'alert' : 'status'}
              aria-atomic="true"
            >
              <span className="toast-icon" aria-hidden="true">
                <Icon size={t.kind === 'critical' ? 20 : 18} />
              </span>
              <div className="toast-copy">
                <div className="toast-title">{t.title}</div>
                {t.detail && <div className="toast-detail">{t.detail}</div>}
              </div>
              <button
                className="icon-btn"
                style={{ width: 24, height: 24, border: 'none', background: 'transparent' }}
                onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}
                aria-label={`Dismiss ${t.title} notification`}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
    </div>
  );

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      {fullscreenHost ? createPortal(toastStack, fullscreenHost) : toastStack}
    </Ctx.Provider>
  );
}

/** Helper hook — dismiss toasts on Escape. */
export function useEscape(onEscape: () => void, when = true) {
  useEffect(() => {
    if (!when) return;
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [onEscape, when]);
}
