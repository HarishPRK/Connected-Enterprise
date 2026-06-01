import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import {
  Check, Cable, Radio, Cpu, ShieldCheck, Activity, Globe2, Cloud, Network,
  MapPin, Settings2, Sparkles,
} from 'lucide-react';

/* ────────── Gateway models ────────── */

interface GatewayModel {
  id: 'CE-GW-300' | 'CE-GW-500' | 'CE-GW-700';
  name: string;
  tagline: string;
  description: string;
  lanPorts: number;
  has5G: boolean;
  dualFiber: boolean;
  maxThroughputMbps: number;
  antennaCount: number;
  poeWatts: number;
  color: string;
  badges: string[];
}

const GATEWAY_MODELS: GatewayModel[] = [
  {
    id: 'CE-GW-300',
    name: 'CE-GW-300',
    tagline: 'Compact branch',
    description: 'Small office or retail — 4 LAN ports, 1 Gbps Fiber, optional 5G failover.',
    lanPorts: 4,
    has5G: false,
    dualFiber: false,
    maxThroughputMbps: 1000,
    antennaCount: 2,
    poeWatts: 30,
    color: '#5fc1f5',
    badges: ['1 Gbps', '4× LAN', 'Wi-Fi 6', 'PoE 30W'],
  },
  {
    id: 'CE-GW-500',
    name: 'CE-GW-500',
    tagline: 'Standard branch',
    description: 'Mid-sized branch — 8 LAN ports, dual-WAN (Fiber + 5G n78), 60 W PoE budget.',
    lanPorts: 8,
    has5G: true,
    dualFiber: false,
    maxThroughputMbps: 1000,
    antennaCount: 3,
    poeWatts: 60,
    color: '#7cffd4',
    badges: ['1 Gbps', '8× LAN', '5G n78', 'PoE 60W'],
  },
  {
    id: 'CE-GW-700',
    name: 'CE-GW-700',
    tagline: 'High-density / HQ',
    description: 'HQ or large site — 12 LAN, 10 Gbps dual-Fiber + dual 5G, redundant PSU.',
    lanPorts: 12,
    has5G: true,
    dualFiber: true,
    maxThroughputMbps: 10_000,
    antennaCount: 4,
    poeWatts: 240,
    color: '#c084fc',
    badges: ['10 Gbps', '12× LAN', 'Dual 5G', 'PoE 240W', 'Redundant PSU'],
  },
];

/* ────────── Form state ────────── */

interface OnboardingForm {
  modelId: GatewayModel['id'];
  serial: string;
  activationCode: string;
  branchName: string;
  location: string;
  timezone: string;
  siteType: 'retail' | 'office' | 'warehouse' | 'factory' | 'datacenter';
  expectedDevices: number;
  firmwareTrack: 'stable' | 'edge' | 'pin-2.4.1';
  adminEmail: string;
  primaryWan: 'fiber' | '5g';
  failoverWan: 'fiber' | '5g' | 'none';
  fiberIpMode: 'dhcp' | 'static';
  fiberStaticIp: string;
  fiberGateway: string;
  fiberSubnet: string;
  dnsPrimary: string;
  dnsSecondary: string;
  fivegApn: string;
  fivegBand: 'auto' | 'n78' | 'n41';
  fivegSimSlot: '1' | '2';
  mtu: number;
  managementVlan: number;
  ntpServer: string;
  syslogDestination: string;
  applyDefaultPolicies: boolean;
  applyDefaultFirewall: boolean;
  enrollOtVlan: boolean;
}

const DEFAULT_FORM: OnboardingForm = {
  modelId: 'CE-GW-500',
  serial: '',
  activationCode: '',
  branchName: '',
  location: '',
  timezone: 'America/Chicago',
  siteType: 'office',
  expectedDevices: 15,
  firmwareTrack: 'stable',
  adminEmail: '',
  primaryWan: 'fiber',
  failoverWan: '5g',
  fiberIpMode: 'dhcp',
  fiberStaticIp: '',
  fiberGateway: '',
  fiberSubnet: '255.255.255.0',
  dnsPrimary: '1.1.1.1',
  dnsSecondary: '8.8.8.8',
  fivegApn: 'internet',
  fivegBand: 'auto',
  fivegSimSlot: '1',
  mtu: 1500,
  managementVlan: 99,
  ntpServer: 'pool.ntp.org',
  syslogDestination: 'logs.tenant.local:514',
  applyDefaultPolicies: true,
  applyDefaultFirewall: true,
  enrollOtVlan: false,
};

const STEPS = ['Claim device', 'Configure WAN', 'Test connectivity', 'Activate'] as const;

/* ────────── Main page ────────── */

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<OnboardingForm>(DEFAULT_FORM);

  const update = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const model = useMemo(
    () => GATEWAY_MODELS.find((m) => m.id === form.modelId) ?? GATEWAY_MODELS[1],
    [form.modelId],
  );

  return (
    <>
      <PageHeader title="Gateway Onboarding" subtitle="Provision a new Enterprise Gateway end-to-end." />

      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <div key={s} style={{ display: 'contents' }}>
            <div className={`step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
              {i < step ? <Check size={14} /> : <span style={{ width: 14, textAlign: 'center' }}>{i + 1}</span>}
              {s}
            </div>
            {i < STEPS.length - 1 && <div className="sep" />}
          </div>
        ))}
      </div>

      <div className="grid">
        <div className="col-7">
          <Card title={STEPS[step]} sub={STEP_SUB[step]}>
            {step === 0 && <StepClaim form={form} update={update} />}
            {step === 1 && <StepWan   form={form} update={update} model={model} />}
            {step === 2 && <StepTest  form={form} model={model} />}
            {step === 3 && <StepActivate form={form} update={update} model={model} />}
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>Back</button>
              {step < STEPS.length - 1
                ? <button className="primary" onClick={() => setStep((s) => s + 1)}>Continue</button>
                : <button className="primary"><Sparkles size={14} />Activate gateway</button>}
            </div>
          </Card>
        </div>

        <div className="col-5" style={{ display: 'flex', flexDirection: 'column', gap: 'clamp(18px, 1.4vw, 28px)' }}>
          <Card
            title={`${model.name} · ${model.tagline}`}
            sub={model.description}
            right={<span className="badge" style={{ color: model.color, borderColor: model.color }}>{`${model.maxThroughputMbps >= 1000 ? `${model.maxThroughputMbps / 1000} Gbps` : `${model.maxThroughputMbps} Mbps`}`}</span>}
          >
            <GatewayIllustration model={model} step={step} />
          </Card>

          <Card title="Step tip" right={<Sparkles size={13} style={{ color: 'var(--accent)' }} />}>
            <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.55 }}>
              {STEP_TIPS[step]}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

const STEP_SUB: Record<number, string> = {
  0: 'Pick the hardware model and link it to your tenant.',
  1: 'Set up primary + failover transport, IP plan, APN, and IP basics.',
  2: 'Run automatic reachability tests across every transport and dependency.',
  3: 'Review the configuration and bring the gateway live.',
};

const STEP_TIPS: Record<number, string> = {
  0: 'Find the serial number printed on the bottom of the device. The activation code is sent to your tenant admin in the shipping email — re-issue from Settings → Tenant if missing.',
  1: 'Pick Fiber as primary when you have a static plan; pick 5G when the site is mobile or the fiber install is pending. The failover transport will be probed every 5 s once the gateway is online.',
  2: 'Tests run sequentially. A red mark on any required test will block activation. The 5G test will time out at 30 s if the antenna is unplugged.',
  3: 'After activation, the gateway publishes itself under Overview within ~45 s. Default IT/OT policies can be re-applied at any time from Traffic Policy.',
};

/* ────────── Step content blocks ────────── */

function StepClaim({
  form, update,
}: {
  form: OnboardingForm;
  update: <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div className="onb-label">Gateway model</div>
        <div className="onb-model-grid">
          {GATEWAY_MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => update('modelId', m.id)}
              className={`onb-model-card ${form.modelId === m.id ? 'is-selected' : ''}`}
              style={form.modelId === m.id ? { borderColor: m.color, boxShadow: `0 0 0 1px ${m.color}55` } : undefined}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: m.color }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{m.name}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.tagline}</div>
              <div style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>
                {m.lanPorts}× LAN · {m.has5G ? 'Fiber + 5G' : 'Fiber'}
              </div>
            </button>
          ))}
        </div>
      </div>

      <SectionLabel>Device identity</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FieldRow label="Serial number" hint="On the bottom sticker">
          <input placeholder="CE-GW-XXXX-XXXX" value={form.serial}
            onChange={(e) => update('serial', e.target.value)} style={{ width: '100%' }} />
        </FieldRow>
        <FieldRow label="Activation code" hint="From tenant admin email">
          <input placeholder="8-digit code" value={form.activationCode}
            onChange={(e) => update('activationCode', e.target.value)} style={{ width: '100%' }} />
        </FieldRow>
      </div>

      <SectionLabel>Site</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FieldRow label="Branch name">
          <input placeholder="Austin-04" value={form.branchName}
            onChange={(e) => update('branchName', e.target.value)} style={{ width: '100%' }} />
        </FieldRow>
        <FieldRow label="Location" icon={MapPin}>
          <input placeholder="City, State" value={form.location}
            onChange={(e) => update('location', e.target.value)} style={{ width: '100%' }} />
        </FieldRow>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <FieldRow label="Site type">
          <select value={form.siteType} onChange={(e) => update('siteType', e.target.value as OnboardingForm['siteType'])} style={{ width: '100%' }}>
            <option value="retail">Retail</option>
            <option value="office">Office</option>
            <option value="warehouse">Warehouse</option>
            <option value="factory">Factory</option>
            <option value="datacenter">Data centre</option>
          </select>
        </FieldRow>
        <FieldRow label="Expected devices" hint="approx.">
          <input type="number" min={1} max={500} value={form.expectedDevices}
            onChange={(e) => update('expectedDevices', Number(e.target.value) || 0)} style={{ width: '100%' }} />
        </FieldRow>
        <FieldRow label="Time zone">
          <select value={form.timezone} onChange={(e) => update('timezone', e.target.value)} style={{ width: '100%' }}>
            <option value="America/New_York">America/New_York</option>
            <option value="America/Chicago">America/Chicago</option>
            <option value="America/Denver">America/Denver</option>
            <option value="America/Los_Angeles">America/Los_Angeles</option>
          </select>
        </FieldRow>
      </div>

      <SectionLabel>Management plane</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <FieldRow label="Firmware track">
          <select value={form.firmwareTrack} onChange={(e) => update('firmwareTrack', e.target.value as OnboardingForm['firmwareTrack'])} style={{ width: '100%' }}>
            <option value="stable">Stable (2.4.1)</option>
            <option value="edge">Edge (2.5.0-rc.3)</option>
            <option value="pin-2.4.1">Pin · 2.4.1</option>
          </select>
        </FieldRow>
        <FieldRow label="Management VLAN">
          <input type="number" min={1} max={4094} value={form.managementVlan}
            onChange={(e) => update('managementVlan', Number(e.target.value) || 99)} style={{ width: '100%' }} />
        </FieldRow>
        <FieldRow label="Admin contact email" hint="for alerts">
          <input placeholder="ops@tenant.com" type="email" value={form.adminEmail}
            onChange={(e) => update('adminEmail', e.target.value)} style={{ width: '100%' }} />
        </FieldRow>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FieldRow label="NTP server">
          <input placeholder="pool.ntp.org" value={form.ntpServer}
            onChange={(e) => update('ntpServer', e.target.value)} style={{ width: '100%' }} />
        </FieldRow>
        <FieldRow label="Syslog destination">
          <input placeholder="host:port" value={form.syslogDestination}
            onChange={(e) => update('syslogDestination', e.target.value)} style={{ width: '100%' }} />
        </FieldRow>
      </div>
    </div>
  );
}

function StepWan({
  form, update, model,
}: {
  form: OnboardingForm;
  update: <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => void;
  model: GatewayModel;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FieldRow label="Primary WAN" icon={Cable}>
        <select value={form.primaryWan} onChange={(e) => update('primaryWan', e.target.value as 'fiber' | '5g')} style={{ width: '100%' }}>
          <option value="fiber">Fiber (Ethernet)</option>
          {model.has5G && <option value="5g">5G (cellular)</option>}
        </select>
      </FieldRow>
      <FieldRow label="Failover WAN" icon={Radio}>
        <select value={form.failoverWan} onChange={(e) => update('failoverWan', e.target.value as 'fiber' | '5g' | 'none')} style={{ width: '100%' }}>
          {model.has5G && <option value="5g">5G (cellular)</option>}
          <option value="fiber">Fiber (secondary)</option>
          <option value="none">No failover</option>
        </select>
      </FieldRow>

      <SectionLabel>Fiber settings</SectionLabel>
      <FieldRow label="IP mode">
        <select value={form.fiberIpMode} onChange={(e) => update('fiberIpMode', e.target.value as 'dhcp' | 'static')} style={{ width: '100%' }}>
          <option value="dhcp">DHCP (automatic)</option>
          <option value="static">Static IP</option>
        </select>
      </FieldRow>
      {form.fiberIpMode === 'static' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <FieldRow label="Static IP">
            <input placeholder="10.0.0.5" value={form.fiberStaticIp}
              onChange={(e) => update('fiberStaticIp', e.target.value)} style={{ width: '100%' }} />
          </FieldRow>
          <FieldRow label="Gateway">
            <input placeholder="10.0.0.1" value={form.fiberGateway}
              onChange={(e) => update('fiberGateway', e.target.value)} style={{ width: '100%' }} />
          </FieldRow>
          <FieldRow label="Subnet mask">
            <input placeholder="255.255.255.0" value={form.fiberSubnet}
              onChange={(e) => update('fiberSubnet', e.target.value)} style={{ width: '100%' }} />
          </FieldRow>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FieldRow label="DNS primary">
          <input placeholder="1.1.1.1" value={form.dnsPrimary}
            onChange={(e) => update('dnsPrimary', e.target.value)} style={{ width: '100%' }} />
        </FieldRow>
        <FieldRow label="DNS secondary">
          <input placeholder="8.8.8.8" value={form.dnsSecondary}
            onChange={(e) => update('dnsSecondary', e.target.value)} style={{ width: '100%' }} />
        </FieldRow>
      </div>

      {model.has5G && (
        <>
          <SectionLabel>5G settings</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
            <FieldRow label="APN">
              <input placeholder="internet" value={form.fivegApn}
                onChange={(e) => update('fivegApn', e.target.value)} style={{ width: '100%' }} />
            </FieldRow>
            <FieldRow label="Band">
              <select value={form.fivegBand} onChange={(e) => update('fivegBand', e.target.value as 'auto' | 'n78' | 'n41')} style={{ width: '100%' }}>
                <option value="auto">Auto</option>
                <option value="n78">n78</option>
                <option value="n41">n41</option>
              </select>
            </FieldRow>
            <FieldRow label="SIM slot">
              <select value={form.fivegSimSlot} onChange={(e) => update('fivegSimSlot', e.target.value as '1' | '2')} style={{ width: '100%' }}>
                <option value="1">SIM 1</option>
                <option value="2">SIM 2</option>
              </select>
            </FieldRow>
          </div>
        </>
      )}

      <SectionLabel>Advanced</SectionLabel>
      <FieldRow label="MTU" icon={Settings2}>
        <input type="number" value={form.mtu} onChange={(e) => update('mtu', Number(e.target.value) || 1500)} style={{ width: '100%' }} />
      </FieldRow>
    </div>
  );
}

/* ────────── Connectivity tests (with simulated sequential run) ────────── */

interface TestSpec {
  id: string;
  label: string;
  detail: string;
  icon: React.ComponentType<{ size?: number }>;
  durationMs: number;
  /** Override how to show the success state — defaults to "OK". */
  result: string;
  pass: boolean;
}

function StepTest({ form, model }: { form: OnboardingForm; model: GatewayModel }) {
  const tests: TestSpec[] = useMemo(() => {
    const out: TestSpec[] = [
      { id: 'power',    label: 'Power-on self-test',  detail: 'ROM, RAM, NVRAM, boot sector',                          icon: Cpu,         durationMs: 700,  result: 'PASS · 412 ms', pass: true },
      { id: 'fiber',    label: 'Fiber link',          detail: form.fiberIpMode === 'dhcp' ? 'DHCP lease + carrier'      : 'Static IP + carrier', icon: Cable, durationMs: 900, result: 'UP · 1000 Mbps full-duplex', pass: true },
    ];
    if (model.has5G) {
      out.push({ id: '5g', label: '5G modem', detail: `APN ${form.fivegApn} · band ${form.fivegBand}`, icon: Radio, durationMs: 1500, result: 'ATTACHED · RSSI -76 dBm', pass: true });
    }
    out.push(
      { id: 'dns',      label: 'DNS resolution',      detail: `${form.dnsPrimary} & ${form.dnsSecondary}`,             icon: Globe2,      durationMs: 600,  result: 'OK · 6 ms avg',   pass: true },
      { id: 'ipsec',    label: 'IPsec tunnel build',  detail: 'IKEv2 to controller · 4 tunnels',                       icon: ShieldCheck, durationMs: 1200, result: '4 / 4 tunnels up', pass: true },
      { id: 'cloud',    label: 'Cloud heartbeat',     detail: 'Controller registration + telemetry stream',            icon: Cloud,       durationMs: 800,  result: 'Reached · 28 ms', pass: true },
      { id: 'aws',      label: 'AWS Cloud OnRamp',    detail: 'Bedrock · S3 reachability',                              icon: Cloud,       durationMs: 900,  result: 'us-east-1 reachable', pass: true },
      { id: 'tput',     label: 'Throughput baseline', detail: '5 s burst test, both directions',                       icon: Activity,    durationMs: 1100, result: '↓ 463 Mbps · ↑ 178 Mbps', pass: true },
    );
    return out;
  }, [form.dnsPrimary, form.dnsSecondary, form.fiberIpMode, form.fivegApn, form.fivegBand, model.has5G]);

  // Sequentially "run" tests: each test goes from queued → running → done.
  const [completed, setCompleted] = useState(0);
  useEffect(() => {
    setCompleted(0);
  }, [tests]);
  useEffect(() => {
    if (completed >= tests.length) return;
    const t = window.setTimeout(() => setCompleted((n) => n + 1), tests[completed].durationMs);
    return () => window.clearTimeout(t);
  }, [completed, tests]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {tests.map((t, i) => {
        const state =
          i < completed ? 'done' :
          i === completed ? 'running' :
          'queued';
        const Icon = t.icon;
        const dotClass = state === 'done' ? 'ok' : state === 'running' ? 'warn' : 'off';
        const accent =
          state === 'done'    ? 'var(--ok)' :
          state === 'running' ? 'var(--warn)' : 'var(--text-muted)';
        return (
          <div key={t.id} className="onb-test-row" style={{ borderLeftColor: accent }}>
            <span style={{ color: accent, display: 'inline-flex' }}><Icon size={14} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{t.label}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{t.detail}</div>
            </div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: accent }}>
              {state === 'done' ? (
                <><Check size={12} />{t.result}</>
              ) : state === 'running' ? (
                <><span className={`dot ${dotClass}`} />Running…</>
              ) : (
                <><span className={`dot ${dotClass}`} />Queued</>
              )}
            </span>
          </div>
        );
      })}
      <div style={{
        marginTop: 8, fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic',
      }}>
        {completed >= tests.length
          ? 'All checks passed — you can activate the gateway.'
          : `${completed} / ${tests.length} checks complete · running…`}
      </div>
    </div>
  );
}

function StepActivate({
  form, update, model,
}: {
  form: OnboardingForm;
  update: <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => void;
  model: GatewayModel;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="onb-summary">
        <SummaryRow label="Model"          value={`${model.name} (${model.tagline})`} />
        <SummaryRow label="Serial / code"  value={`${form.serial || '—'} / ${form.activationCode || '—'}`} />
        <SummaryRow label="Branch"         value={`${form.branchName || '—'} · ${form.location || '—'}`} />
        <SummaryRow label="Site type"      value={`${form.siteType} · ~${form.expectedDevices} devices`} />
        <SummaryRow label="Firmware"       value={form.firmwareTrack} />
        <SummaryRow label="Primary WAN"    value={form.primaryWan === 'fiber' ? 'Fiber' : '5G'} />
        <SummaryRow label="Failover WAN"   value={form.failoverWan === 'none' ? 'None' : form.failoverWan === '5g' ? '5G' : 'Fiber (secondary)'} />
        <SummaryRow label="IP mode"        value={form.fiberIpMode === 'dhcp' ? 'DHCP' : `Static · ${form.fiberStaticIp || '—'}`} />
        <SummaryRow label="DNS"            value={`${form.dnsPrimary} · ${form.dnsSecondary}`} />
        {model.has5G && <SummaryRow label="5G APN / band" value={`${form.fivegApn} · ${form.fivegBand}`} />}
        <SummaryRow label="Management"     value={`VLAN ${form.managementVlan} · NTP ${form.ntpServer}`} />
        <SummaryRow label="Syslog"         value={form.syslogDestination} />
        <SummaryRow label="Admin contact"  value={form.adminEmail || '—'} />
        <SummaryRow label="MTU"            value={String(form.mtu)} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <CheckboxRow
          label="Apply default IT/OT routing policies"
          detail="Voice/Video high priority, OT VLAN segmented, idle traffic deprioritised."
          checked={form.applyDefaultPolicies}
          onChange={(v) => update('applyDefaultPolicies', v)}
        />
        <CheckboxRow
          label="Apply default firewall ruleset"
          detail="Block inbound except IPsec, deny OT→Internet, allow telemetry egress."
          checked={form.applyDefaultFirewall}
          onChange={(v) => update('applyDefaultFirewall', v)}
        />
        <CheckboxRow
          label="Auto-enrol OT VLAN (VLAN 20)"
          detail="Provisions DHCP scope 10.20.1.0/24 and the OT firewall zone."
          checked={form.enrollOtVlan}
          onChange={(v) => update('enrollOtVlan', v)}
        />
      </div>
    </div>
  );
}

/* ────────── Animated gateway illustration ────────── */

function GatewayIllustration({ model, step }: { model: GatewayModel; step: number }) {
  // Each step lights up the device a little more, mimicking a real provisioning
  // sequence: power-on → WAN sync → live tests → fully online.
  const power     = step >= 0;         // device claimed
  const wanLit    = step >= 1;         // WAN configured
  const testing   = step === 2;        // tests running
  const allOnline = step >= 3;         // activated

  const W = 300;
  const VBH = 190;
  const bodyH = 92;
  const bodyW = 252;
  const bodyX = (W - bodyW) / 2;
  const bodyY = 64;

  // Port spacing — fit lanPorts across the body width
  const portCount = model.lanPorts;
  const portAreaW = bodyW - 30;
  const portW = Math.min(14, portAreaW / portCount - 2);
  const portGap = (portAreaW - portW * portCount) / Math.max(1, portCount - 1);

  // Antenna positions
  const antennaY = bodyY - 22;
  const antennaSpan = bodyW * 0.6;
  const antennaStartX = (W - antennaSpan) / 2;
  const antennaPositions = Array.from({ length: model.antennaCount }, (_, i) =>
    model.antennaCount === 1
      ? W / 2
      : antennaStartX + (antennaSpan * i) / (model.antennaCount - 1),
  );

  // LED colors
  const offColor = 'rgba(255,255,255,0.10)';
  const okColor = '#74e8a1';
  const warnColor = '#ffb547';

  return (
    <div className="onb-illustration">
      <svg
        viewBox={`0 0 ${W} ${VBH}`}
        style={{ display: 'block', width: '100%', maxWidth: 360, maxHeight: 220 }}
      >
        <defs>
          <linearGradient id="onb-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="rgba(255,255,255,0.10)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
          </linearGradient>
          <radialGradient id="onb-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor={model.color} stopOpacity={0.6} />
            <stop offset="100%" stopColor={model.color} stopOpacity={0} />
          </radialGradient>
          <filter id="onb-soft">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>

        {/* Antenna signal waves — only visible when 5G testing or online */}
        {model.has5G && (testing || allOnline) && (
          <g>
            {antennaPositions.map((ax, i) => (
              <g key={`wave-${i}`}>
                {[10, 18, 26].map((r, ri) => (
                  <circle
                    key={ri}
                    cx={ax} cy={antennaY - 12}
                    r={r}
                    fill="none"
                    stroke={model.color}
                    strokeWidth={1}
                    opacity={0.5 - ri * 0.12}
                  >
                    <animate
                      attributeName="r"
                      values={`${r};${r + 8};${r}`}
                      dur={`${1.6 + i * 0.2}s`}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values={`${0.5 - ri * 0.12};0;${0.5 - ri * 0.12}`}
                      dur={`${1.6 + i * 0.2}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                ))}
              </g>
            ))}
          </g>
        )}

        {/* Antennas */}
        {antennaPositions.map((ax, i) => (
          <g key={`ant-${i}`}>
            <rect x={ax - 1.6} y={antennaY - 22} width={3.2} height={28} rx={1.6}
              fill={power ? model.color : 'rgba(255,255,255,0.15)'} opacity={power ? 0.95 : 0.6} />
            <circle cx={ax} cy={antennaY - 22} r={2} fill={power ? model.color : offColor} />
          </g>
        ))}

        {/* Glow halo around the body when fully online */}
        {allOnline && (
          <ellipse cx={W / 2} cy={bodyY + bodyH / 2} rx={bodyW / 2 + 20} ry={bodyH / 2 + 12} fill="url(#onb-glow)" filter="url(#onb-soft)" />
        )}

        {/* Router body */}
        <rect
          x={bodyX} y={bodyY} width={bodyW} height={bodyH} rx={8}
          fill="url(#onb-body)"
          stroke={power ? model.color : 'rgba(255,255,255,0.18)'}
          strokeWidth={1.4}
          opacity={power ? 1 : 0.7}
        />
        {/* Top tint stripe */}
        <rect x={bodyX + 2} y={bodyY + 2} width={bodyW - 4} height={2.5} rx={1.2} fill={model.color} opacity={power ? 0.8 : 0.2} />

        {/* Model badge */}
        <text x={bodyX + bodyW - 8} y={bodyY + 16} textAnchor="end" fontSize="9" fontWeight={700} fill="rgba(255,255,255,0.55)" letterSpacing="0.06em">
          {model.name}
        </text>

        {/* Status LED row */}
        <g transform={`translate(${bodyX + 12} ${bodyY + 18})`}>
          {[
            { label: 'PWR', on: power,   color: okColor },
            { label: 'WAN', on: wanLit,  color: testing ? warnColor : (wanLit ? okColor : offColor) },
            { label: '5G',  on: model.has5G && (testing || allOnline), color: testing ? warnColor : okColor, hidden: !model.has5G },
            { label: 'CLD', on: allOnline, color: okColor },
            { label: 'OK',  on: allOnline, color: okColor },
          ].filter((l) => !l.hidden).map((led, i) => (
            <g key={led.label} transform={`translate(${i * 22} 0)`}>
              <circle r={3} fill={led.on ? led.color : offColor}>
                {(testing && led.label === 'WAN') && (
                  <animate attributeName="opacity" values="1;0.3;1" dur="0.7s" repeatCount="indefinite" />
                )}
                {(testing && led.label === '5G') && (
                  <animate attributeName="opacity" values="1;0.3;1" dur="0.9s" repeatCount="indefinite" />
                )}
                {(allOnline && led.label === 'OK') && (
                  <animate attributeName="opacity" values="1;0.55;1" dur="1.4s" repeatCount="indefinite" />
                )}
              </circle>
              <text x={0} y={12} textAnchor="middle" fontSize="6.5" fill="rgba(255,255,255,0.55)" letterSpacing="0.06em">{led.label}</text>
            </g>
          ))}
        </g>

        {/* LAN port row — kept well inside the body so it never overlaps with
            siblings on the page. */}
        <g transform={`translate(${bodyX + 15} ${bodyY + bodyH - 28})`}>
          {Array.from({ length: portCount }).map((_, i) => {
            const x = i * (portW + portGap);
            // Light up some ports during testing to suggest link-train activity.
            const lit = testing
              ? (i + Math.floor(Date.now() / 500)) % 3 === 0
              : allOnline && i < 3;
            return (
              <g key={i} transform={`translate(${x} 0)`}>
                <rect x={0} y={0} width={portW} height={11} rx={1.5}
                  fill="rgba(0,0,0,0.35)"
                  stroke={lit ? okColor : 'rgba(255,255,255,0.22)'}
                  strokeWidth={1}
                />
                <circle cx={portW / 2} cy={-4} r={1.4}
                  fill={lit ? okColor : offColor}>
                  {testing && (
                    <animate attributeName="opacity" values="0;1;0" dur={`${0.5 + (i % 5) * 0.15}s`} repeatCount="indefinite" />
                  )}
                </circle>
              </g>
            );
          })}
          {/* "LAN" label underneath the port row, still inside the body */}
          <text x={0} y={20} fontSize="6.5" fill="rgba(255,255,255,0.45)" letterSpacing="0.08em">LAN PORTS</text>
        </g>

        {/* "Booting" sweep across body when in step 0 */}
        {step === 0 && (
          <rect x={bodyX} y={bodyY + bodyH - 1} width={bodyW} height={1.5} fill={model.color} opacity={0.7}>
            <animate attributeName="x" values={`${bodyX};${bodyX + bodyW};${bodyX}`} dur="2.2s" repeatCount="indefinite" />
            <animate attributeName="width" values="40;0;40" dur="2.2s" repeatCount="indefinite" />
          </rect>
        )}
      </svg>

      {/* Caption under the illustration */}
      <div className="onb-caption">
        {step === 0 && 'Powering on · provisioning controller link…'}
        {step === 1 && 'WAN profile configured · port LEDs synced'}
        {step === 2 && 'Live link tests in progress · ports negotiating speed'}
        {step === 3 && 'Online · publishing to fleet'}
      </div>

      {/* Badge strip — capability summary, framed with the device */}
      <div className="onb-badges">
        {model.badges.map((b) => (
          <span key={b} className="onb-cap-pill" style={{ borderColor: model.color, color: model.color }}>{b}</span>
        ))}
      </div>
    </div>
  );
}

/* ────────── Tiny shared primitives ────────── */

function FieldRow({
  label, hint, icon: Icon, children,
}: {
  label: string;
  hint?: string;
  icon?: React.ComponentType<{ size?: number }>;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {Icon && <Icon size={11} />}
        {label}
        {hint && <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--accent)',
      paddingTop: 4,
    }}>
      <Network size={12} />
      {children}
      <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function CheckboxRow({
  label, detail, checked, onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="onb-checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>{detail}</div>
      </div>
    </label>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <span className="k">{label}</span>
      <span className="v" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{value}</span>
    </div>
  );
}
