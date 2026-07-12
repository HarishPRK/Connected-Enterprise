import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'warn' | 'error' | 'info';
interface Toast { id: number; kind: ToastKind; title: string; detail?: string; }

interface ToastCtx {
  push: (t: Omit<Toast, 'id'>) => void;
}
const Ctx = createContext<ToastCtx | null>(null);

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}

const iconFor = { success: CheckCircle2, warn: AlertTriangle, error: XCircle, info: Info };
const colorFor: Record<ToastKind, string> = {
  success: 'var(--ok)', warn: 'var(--warn)', error: 'var(--err)', info: 'var(--accent)',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, ...t }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => {
          const Icon = iconFor[t.kind];
          return (
            <div key={t.id} className="toast" style={{ borderLeftColor: colorFor[t.kind] }}>
              <Icon size={18} style={{ color: colorFor[t.kind], flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div className="toast-title">{t.title}</div>
                {t.detail && <div className="toast-detail">{t.detail}</div>}
              </div>
              <button
                className="icon-btn"
                style={{ width: 24, height: 24, border: 'none', background: 'transparent' }}
                onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}
                aria-label="dismiss"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
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
