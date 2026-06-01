import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { useToast } from '../ui/Toast';

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`switch ${on ? 'on' : ''}`}
      onClick={() => onChange(!on)}
      style={{ padding: 0, border: 'none' }}
      aria-pressed={on}
    />
  );
}

export function SettingsPage() {
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [smsAlerts,   setSmsAlerts]   = useState(true);
  const [digest,      setDigest]      = useState(false);
  const [aiAuto,      setAiAuto]      = useState(true);
  const { push } = useToast();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Operations team preferences"
        right={<button className="primary" onClick={() => push({ kind: 'success', title: 'Settings saved' })}>Save changes</button>}
      />
      <div className="grid">
        <div className="col-6">
          <Card title="Notifications" sub="How and when we alert you">
            <div className="kv"><span className="k">Email on critical alerts</span><Switch on={emailAlerts} onChange={setEmailAlerts} /></div>
            <div className="kv"><span className="k">SMS on OT device failure</span><Switch on={smsAlerts} onChange={setSmsAlerts} /></div>
            <div className="kv"><span className="k">Daily ops digest (08:00)</span><Switch on={digest} onChange={setDigest} /></div>
          </Card>
        </div>
        <div className="col-6">
          <Card title="AI Assistant" sub="Behavior of the GenAI / agentic helper">
            <div className="kv"><span className="k">Auto-triage incoming alerts</span><Switch on={aiAuto} onChange={setAiAuto} /></div>
            <label className="kv"><span className="k">Tone</span>
              <select defaultValue="concise"><option value="concise">Concise</option><option value="detailed">Detailed</option></select>
            </label>
            <label className="kv"><span className="k">Model</span>
              <select defaultValue="haiku"><option value="haiku">Haiku 4.5 (fast)</option><option value="sonnet">Sonnet 4.6 (balanced)</option><option value="opus">Opus 4.7 (deep)</option></select>
            </label>
          </Card>
        </div>
        <div className="col-6">
          <Card title="Regional">
            <label className="kv"><span className="k">Timezone</span>
              <select defaultValue="ct"><option value="ct">America/Chicago (CT)</option><option value="et">America/New_York (ET)</option><option value="pt">America/Los_Angeles (PT)</option><option value="utc">UTC</option></select>
            </label>
            <label className="kv"><span className="k">Theme</span>
              <select defaultValue="dark"><option value="dark">Dark</option><option value="light">Light</option><option value="auto">System</option></select>
            </label>
            <label className="kv"><span className="k">Density</span>
              <select defaultValue="comfortable"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select>
            </label>
          </Card>
        </div>
        <div className="col-6">
          <Card title="API & Integrations" sub="Cloud endpoints and connectors">
            <div className="kv"><span className="k">AWS Region</span><span className="v">us-east-1</span></div>
            <div className="kv"><span className="k">Telemetry endpoint</span><span className="v mono">https://api.ce.example/v1/telemetry</span></div>
            <div className="kv"><span className="k">PagerDuty</span><span className="badge ok">Connected</span></div>
            <div className="kv"><span className="k">Slack</span><span className="badge">Not connected</span></div>
          </Card>
        </div>
      </div>
    </>
  );
}
