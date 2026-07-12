import type { Status } from '../types';

const cls: Record<Status, string> = { ok: 'ok', warn: 'warn', err: 'err', off: '' };
const label: Record<Status, string> = { ok: 'Healthy', warn: 'Degraded', err: 'Offline', off: 'Inactive' };

export function StatusBadge({ status, text }: { status: Status; text?: string }) {
  return (
    <span className={`badge ${cls[status]}`}>
      <span className={`dot ${status}`} />
      {text ?? label[status]}
    </span>
  );
}
