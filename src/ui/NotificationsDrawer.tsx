import { Drawer } from './Drawer';
import { alerts } from '../data/mock';
import type { Alert } from '../types';
import { Bell } from 'lucide-react';

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const list: Alert[] = alerts;
  return (
    <Drawer open={open} onClose={onClose} title={<span><Bell size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Notifications</span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((a) => (
          <div key={a.id} className={`alert-row ${a.level}`}>
            <div className="alert-body">
              <div className="alert-title">{a.title}</div>
              <div className="alert-meta">{a.detail} · {timeAgo(a.whenISO)}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button style={{ flex: 1 }}>Mark all read</button>
        <button style={{ flex: 1 }}>Notification settings</button>
      </div>
    </Drawer>
  );
}
