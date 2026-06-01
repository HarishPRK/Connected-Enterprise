import { Card } from '../Card';
import type { Alert } from '../../types';
import { Link } from 'react-router-dom';

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diff / 60000));
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function AlertsWidget({ alerts }: { alerts: Alert[] }) {
  return (
    <Card
      title="Alerts"
      sub={`${alerts.filter((a) => a.level !== 'ok').length} active`}
      right={<Link to="/ask-ai"><button>Ask AI to triage</button></Link>}
    >
      {alerts.slice(0, 5).map((a) => (
        <div key={a.id} className={`alert-row ${a.level}`}>
          <div className="alert-body">
            <div className="alert-title">{a.title}</div>
            <div className="alert-meta">{a.detail} · {timeAgo(a.whenISO)}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}
