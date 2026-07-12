import type { ReactNode } from 'react';
import { useEscape } from './Toast';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  width?: number;
  children?: ReactNode;
}

export function Drawer({ open, onClose, title, width = 420, children }: DrawerProps) {
  useEscape(onClose, open);
  return (
    <>
      <div className={`drawer-backdrop ${open ? 'open' : ''}`} onClick={onClose} />
      <aside
        className={`drawer ${open ? 'open' : ''}`}
        style={{ width }}
        role="dialog"
        aria-hidden={!open}
      >
        <div className="drawer-head">
          <div className="card-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="close" style={{ border: 'none', background: 'transparent' }}>
            <X size={16} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}
