import { useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { useToast } from '../ui/Toast';
import { useTheme } from '../ui/Theme';
import { readPreferences, savePreferences, type Preferences } from '../ui/preferences';

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} style={{ padding: 0, border: 'none' }} role="switch" aria-label={label} aria-checked={on} />;
}

export function SettingsPage() {
  const [draft, setDraft] = useState<Preferences>(readPreferences);
  const [saved, setSaved] = useState<Preferences>(readPreferences);
  const [availableModels, setAvailableModels] = useState<Array<{ value: Preferences['model']; modelId: string }>>([]);
  const [modelError, setModelError] = useState('');
  const { setTheme, setThemeMode } = useTheme();
  const { push } = useToast();
  const change = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setDraft((p) => ({ ...p, [key]: value }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/ai/capabilities', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Model configuration could not be read (${response.status})`);
      const data = await response.json();
      const models = Array.isArray(data.availableModels) ? data.availableModels.filter((model: { value?: string; modelId?: string }) => ['haiku', 'sonnet', 'opus'].includes(model.value ?? '') && typeof model.modelId === 'string') : [];
      if (!models.length) throw new Error('No AI models are configured.');
      setAvailableModels(models);
      setDraft((value) => models.some((model: { value: string }) => model.value === value.model) ? value : { ...value, model: data.defaultModel ?? models[0].value });
    }).catch((error) => { if (!controller.signal.aborted) setModelError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, []);
  function save() {
    try {
      savePreferences(draft);
      if (draft.theme === 'auto') setThemeMode('auto');
      else setTheme(draft.theme);
      setSaved(draft);
      push({ kind: 'success', title: 'Preferences saved', detail: 'Saved on this browser. Delivery channels and automated remediation require a configured service.' });
    } catch (error) {
      push({ kind: 'error', title: 'Preferences could not be saved', detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return <>
    <PageHeader title="Settings" subtitle="Operations preferences saved on this browser" right={<button className="primary" onClick={save} disabled={!dirty}>Save changes</button>} />
    <div className="grid">
      <div className="col-6"><Card title="Notifications" sub="Delivery preferences · email and SMS services are not configured">
        <div className="kv"><span className="k">Email on critical alerts</span><Switch label="Email on critical alerts" on={draft.emailAlerts} onChange={(v) => change('emailAlerts', v)} /></div>
        <div className="kv"><span className="k">SMS on OT device failure</span><Switch label="SMS on OT device failure" on={draft.smsAlerts} onChange={(v) => change('smsAlerts', v)} /></div>
        <div className="kv"><span className="k">Daily ops digest (08:00)</span><Switch label="Daily ops digest" on={draft.digest} onChange={(v) => change('digest', v)} /></div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>These preferences do not send notifications until a delivery service is connected.</p>
      </Card></div>
      <div className="col-6"><Card title="AI Assistant" sub="Tone and model apply to new Ask AI requests">
        <div className="kv"><span className="k">Assign incoming incidents to agent</span><Switch label="Assign incoming incidents to agent" on={draft.aiAuto} onChange={(v) => change('aiAuto', v)} /></div>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Applies to new live incidents. Turn off to assign them for operator review. Analysis and remediation require operator action.</p>
        <label className="kv"><span className="k">Tone</span><select value={draft.tone} onChange={(e) => change('tone', e.target.value as Preferences['tone'])}><option value="concise">Concise</option><option value="detailed">Detailed</option></select></label>
        <label className="kv"><span className="k">Model</span><select value={draft.model} disabled={!availableModels.length} onChange={(e) => change('model', e.target.value as Preferences['model'])}>{availableModels.length ? availableModels.map((model) => <option key={model.value} value={model.value}>{model.value === 'haiku' ? 'Default' : model.value === 'sonnet' ? 'Sonnet' : 'Opus'} · {model.modelId}</option>) : <option value={draft.model}>{modelError ? 'Configuration unavailable' : 'Loading models…'}</option>}</select></label>
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>{modelError || 'Only models configured on this server are available.'}</p>
      </Card></div>
      <div className="col-6"><Card title="Regional" sub="Applied when you save">
        <label className="kv"><span className="k">Timezone</span><select value={draft.timeZone} onChange={(e) => change('timeZone', e.target.value as Preferences['timeZone'])}><option value="America/Chicago">America/Chicago (CT)</option><option value="America/New_York">America/New_York (ET)</option><option value="America/Los_Angeles">America/Los_Angeles (PT)</option><option value="UTC">UTC</option></select></label>
        <label className="kv"><span className="k">Theme</span><select value={draft.theme} onChange={(e) => change('theme', e.target.value as Preferences['theme'])}><option value="dark">Dark</option><option value="light">Light</option><option value="auto">System</option></select></label>
        <label className="kv"><span className="k">Density</span><select value={draft.density} onChange={(e) => change('density', e.target.value as Preferences['density'])}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      </Card></div>
      <div className="col-6"><Card title="API & Integrations" sub="Application connection details">
        <div className="kv"><span className="k">API origin</span><span className="v mono">{window.location.origin}</span></div>
        <div className="kv"><span className="k">Telemetry endpoint</span><span className="v mono">/api/ipsec/snapshot</span></div>
        <div className="kv"><span className="k">PagerDuty</span><span className="badge">Not configured</span></div>
        <div className="kv"><span className="k">Slack</span><span className="badge">Not configured</span></div>
      </Card></div>
    </div>
  </>;
}
