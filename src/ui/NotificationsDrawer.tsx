import { Drawer } from './Drawer';
import { alerts } from '../data/mock';
import type { Alert } from '../types';
import { Bell } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function NotificationsDrawer({ open, onClose, readIds, onMarkRead }: { open: boolean; onClose: () => void; readIds: readonly string[]; onMarkRead: () => void }) {
  const navigate = useNavigate();
  const list: Alert[] = alerts.filter((alert) => alert.level !== 'ok');
  const unread = list.filter((alert) => !readIds.includes(alert.id)).length;
  return (
    <Drawer open={open} onClose={onClose} title={<span><Bell size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Notifications</span>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((a) => (
          <Link key={a.id} to="/incidents" onClick={onClose} className={`alert-row ${a.level}`} style={{ opacity: readIds.includes(a.id) ? 0.6 : 1, textDecoration: 'none' }}>
            <div className="alert-body">
              <div className="alert-title">{a.title}{readIds.includes(a.id) ? ' · Read' : ' · Unread'}</div>
              <div className="alert-meta">{a.detail} · {timeAgo(a.whenISO)}</div>
            </div>
          </Link>
        ))}
      </div>
      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button style={{ flex: 1 }} onClick={onMarkRead} disabled={unread === 0}>{unread === 0 ? 'All read' : 'Mark all read'}</button>
        <button style={{ flex: 1 }} onClick={() => { onClose(); navigate('/settings'); }}>Notification settings</button>
      </div>
    </Drawer>
  );
}
