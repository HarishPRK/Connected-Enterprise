import type { ReactNode } from 'react';
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
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div className="card-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="close" style={{ border: 'none', background: 'transparent' }}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
