import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useEscape } from './Toast';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, children, footer, width = 460 }: ModalProps) {
  useEscape(onClose, open);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableSelector = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    const preferredFocus = dialog.querySelector<HTMLElement>('[data-autofocus]');
    (preferredFocus ?? focusable[0] ?? dialog).focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const current = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!current.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', trapFocus);
    return () => {
      dialog.removeEventListener('keydown', trapFocus);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div className="card-title" id={titleId}>{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label={`Close ${title}`} style={{ border: 'none', background: 'transparent' }}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
