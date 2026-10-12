import { useRef, type ReactNode } from 'react';
import { useEscape } from './Toast';
import { X } from 'lucide-react';
import { useDialogFocus } from './useDialogFocus';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  width?: number;
  children?: ReactNode;
}

export function Drawer({ open, onClose, title, width = 420, children }: DrawerProps) {
  useEscape(onClose, open);
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(open, ref);
  return (
    <>
      <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={onClose} />
      <aside
        ref={ref}
        tabIndex={-1}
        inert={!open}
        className={`drawer ${open ? 'open' : ''}`}
        style={{ width }}
        role="dialog"
        aria-modal={open || undefined}
        aria-label={typeof title === 'string' ? title : 'Details'}
        aria-hidden={!open}
      >
        <div className="drawer-head">
          <div className="card-title">{title}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details" style={{ border: 'none', background: 'transparent' }}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
