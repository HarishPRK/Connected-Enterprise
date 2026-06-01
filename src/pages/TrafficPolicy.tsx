import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { trafficPolicies } from '../data/mock';
import { GripVertical, Plus } from 'lucide-react';

const prioBadge = { high: 'err', med: 'warn', low: '' } as const;

export function TrafficPolicyPage() {
  return (
    <>
      <PageHeader
        title="Traffic Policy"
        subtitle="Application priority and preferred WAN path for critical traffic"
        right={<button className="primary"><Plus size={14} style={{ marginRight: 6, verticalAlign: -2 }} />New policy</button>}
      />
      <Card>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Application</th>
              <th>Priority</th>
              <th>Preferred Path</th>
              <th>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {trafficPolicies.map((p) => (
              <tr key={p.id}>
                <td style={{ color: 'var(--text-muted)', cursor: 'grab' }}><GripVertical size={14} /></td>
                <td>{p.app}</td>
                <td><span className={`badge ${prioBadge[p.priority]}`}>{p.priority.toUpperCase()}</span></td>
                <td>{p.preferredPath}</td>
                <td>
                  <span className={`badge ${p.enabled ? 'ok' : ''}`}>
                    {p.enabled ? 'ON' : 'OFF'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
