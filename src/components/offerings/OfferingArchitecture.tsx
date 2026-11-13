import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../Card';
import {
  Activity, ArrowLeftRight, ArrowRight, Boxes, Cloud, GitBranch, Layers3, Leaf, Package,
  Radio, Sparkles, Video, Zap,
} from 'lucide-react';
import './OfferingArchitecture.css';

interface Offering {
  id: string;
  name: string;
  ml: boolean;                 // ships with ML libraries
  icon: ComponentType<{ size?: number }>;
  accent: string;              // css var string
  rgbVar: string;              // matching -rgb token for tints
  capabilities: string[];
}

const OFFERINGS: Offering[] = [
  {
    id: 'interoperability', name: 'Interoperability', ml: true,
    icon: ArrowLeftRight, accent: 'var(--accent)', rgbVar: '--accent-rgb',
    capabilities: [
      'Conversion of various industry protocols (OPC-UA, MQTT, Modbus, BACnet)',
    ],
  },
  {
    id: 'eagle', name: 'EA:GLE — Edge Analytics', ml: true,
    icon: Activity, accent: 'var(--accent-3)', rgbVar: '--accent-3-rgb',
    capabilities: [
      'Real-time data processing on the edge',
      'Predictive analytics with self-healing',
    ],
  },
  {
    id: 'dynamic-failover', name: 'Dynamic Failover', ml: true,
    icon: GitBranch, accent: 'var(--ok)', rgbVar: '--ok-rgb',
    capabilities: [
      'Automatic failover',
      'Load balancing',
      'Application-aware routing',
      'Policy-based path control',
      'SLA-based routing',
    ],
  },
  {
    id: 'greengrass', name: 'AWS Greengrass', ml: false,
    icon: Cloud, accent: 'var(--warn)', rgbVar: '--warn-rgb',
    capabilities: [
      'Local edge data processing',
      'Interface with AWS Cloud for device onboarding / provisioning',
      'Remote device management',
    ],
  },
  {
    id: 'matter', name: 'Matter', ml: true,
    icon: Boxes, accent: 'var(--accent-2)', rgbVar: '--accent-2-rgb',
    capabilities: [
      'Enterprise automation',
      'Enterprise safety',
      'Remote monitoring & control',
    ],
  },
  {
    id: 'thread-border-router', name: 'Thread Border Router', ml: false,
    icon: Radio, accent: 'var(--accent-2)', rgbVar: '--accent-2-rgb',
    capabilities: [
      'Thread mesh backbone for Matter devices',
      'Enterprise automation, safety, and remote monitoring & control',
    ],
  },
  {
    id: 'energy-prediction', name: 'Energy Prediction', ml: true,
    icon: Zap, accent: 'var(--warn)', rgbVar: '--warn-rgb',
    capabilities: [
      'Monitoring, prediction and preventive maintenance of energy-consuming appliances',
      'Anomaly detection — machine-learning based solution',
    ],
  },
  {
    id: 'sustainability', name: 'Sustainability', ml: true,
    icon: Leaf, accent: 'var(--ok)', rgbVar: '--ok-rgb',
    capabilities: [
      'Irrigation systems',
      'Blinds / shades',
      'Thermostats',
      'Power outlets',
      'Leak detection',
      'Indoor air quality',
    ],
  },
  {
    id: 'video-analytics', name: 'Video Analytics', ml: true,
    icon: Video, accent: 'var(--accent-3)', rgbVar: '--accent-3-rgb',
    capabilities: [
      'Real-time video inference powered by DELL',
      'Fall, intrusion, fire and weapon detection',
      'PPE compliance monitoring',
      'Inventory, parking and crowd analytics',
      'Live detection alerts for operators',
    ],
  },
];

const STACK: { group: string; note: string; items: string[] }[] = [
  { group: 'Solution layer', note: 'Consumer-facing capabilities', items: ['Edge Analytics', 'AI / ML', 'Generative AI', 'Agentic AI', 'Store automation'] },
  { group: 'Standards & protocols', note: 'Interoperability foundation', items: ['Matter', 'mDNS / DNS-SD', 'MQTT', 'Modbus', 'OPC UA', 'BACnet'] },
  { group: 'Connectivity', note: 'Wireless + wired transport', items: ['Wi-Fi 7', '5G', 'Fiber', 'Thread', 'LoRaWAN', 'Bluetooth'] },
  { group: 'OS platforms', note: 'Gateway operating environment', items: ['Linux', 'OpenWrt'] },
  { group: 'Silicon', note: 'Hardware foundation', items: ['MaxLinear', 'Quectel', 'Silicon Labs'] },
];

export function OfferingArchitecture() {
  const mlCount = OFFERINGS.filter(offering => offering.ml).length;
  return <section id="architecture-offerings" className="enterprise-architecture" aria-labelledby="architecture-offerings-title">
    <div className="enterprise-architecture-heading">
      <h2 id="architecture-offerings-title">Architecture &amp; offerings</h2>
      <p>The service containers and technology behind the connected enterprise.</p>
    </div>
      <div className="kpi-strip service-offerings-kpis">
        <SoKpi label="Containers available" value={`${OFFERINGS.length} / ${OFFERINGS.length}`}
          sub="ready on the gateway today" icon={Package} accent="var(--ok)" rgbVar="--ok-rgb" />
        <SoKpi label="ML-powered services" value={String(mlCount)}
          sub="ship with ML libraries on the edge" icon={Sparkles} accent="var(--accent-3)" rgbVar="--accent-3-rgb" />
        <SoKpi label="Container runtime" value="prplLCM"
          sub="lifecycle-managed containers on prplOS" icon={Layers3} accent="var(--accent)" rgbVar="--accent-rgb" />
        <SoKpi label="Northbound delivery" value="Consumer APIs"
          sub="every service exposed as an API" icon={Cloud} accent="var(--accent-2)" rgbVar="--accent-2-rgb" />
      </div>

      <div className="grid">
        <div className="col-12">
          <Card
            title={<h3>Smart services on the edge / enterprise gateway</h3>}
            sub="Each offering runs as an isolated container with its libraries — consumed from above through APIs, managed below by prplLCM."
            right={
              <div className="so-brand-lockup">
                <img src="/capgemini.jpg" alt="Capgemini" />
                <span>Capgemini</span>
              </div>
            }
          >
            {/* APIs above, service containers in the middle, runtime below. */}
            <div className="so-arch-band">Consumer-facing APIs</div>
            <div className="so-grid">
              {OFFERINGS.map((o, index) => <OfferingCard key={o.id} o={o} container={index + 1} />)}
            </div>
            <div className="so-arch-band so-arch-band-bottom">prplLCM · container lifecycle manager</div>
          </Card>
        </div>

        <div className="col-12">
          <Link className="so-savings-link" to="/cost-insights">
            <span><strong>See the outcome: Cost Savings</strong><small>Measure avoided truck rolls, support effort, energy use, and service disruption.</small></span>
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </div>

        <div className="col-12">
          <Card
            title={<h3>Gateway technology stack</h3>}
            sub="What the offerings are built on — protocols, connectivity, standards, platforms and silicon."
          >
            <div className="so-pyramid" aria-label="Gateway technology hierarchy">
              <svg className="so-pyramid-guide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polygon points="50,0 100,100 0,100" />
                <line x1="36" y1="28.3" x2="64" y2="28.3" />
                <line x1="27" y1="46.2" x2="73" y2="46.2" />
                <line x1="18" y1="64.1" x2="82" y2="64.1" />
                <line x1="9" y1="82.1" x2="91" y2="82.1" />
              </svg>
              {STACK.map((row, index) => (
                <div key={row.group} className={`so-pyramid-layer so-pyramid-layer-${index + 1}`}>
                  <div className="so-pyramid-copy"><strong>{row.group}</strong><span>{row.note}</span></div>
                  <div className="so-stack-chips">
                    {row.items.map((it) => <span key={it} className="so-chip">{it}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
  </section>;
}

/* ─────────── Offering card ─────────── */

function OfferingCard({ o, container }: { o: Offering; container: number }) {
  const Icon = o.icon;
  return (
    <div className="so-card" id={`offering-${o.id}`} tabIndex={-1}>
      <div className="so-card-head">
        <span className="so-icon" style={{ color: o.accent, background: `linear-gradient(135deg, rgba(var(${o.rgbVar}) / 0.16), transparent)` }}>
          <Icon size={16} />
        </span>
        <span className="so-name">{o.name}</span>
        <span className="badge ok" style={{ marginLeft: 'auto' }}>Available</span>
      </div>
      <div className="so-container-tag mono">
        Container {container} · + libraries{o.ml ? ' (ML)' : ''}
      </div>
      <ul className="so-caps">
        {o.capabilities.map((cap) => (
          <li key={cap}><span className="so-cap-dot" style={{ background: o.accent }} />{cap}</li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────── KPI tile ─────────── */

function SoKpi({ label, value, sub, icon: Icon, accent, rgbVar }: {
  label: string;
  value: string;
  sub: string;
  icon: ComponentType<{ size?: number }>;
  accent: string;
  rgbVar: string;
}) {
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <div className="kpi-icon" style={{ color: accent, background: `linear-gradient(135deg, rgba(var(${rgbVar}) / 0.18), transparent)` }}>
          <Icon size={16} />
        </div>
        <div className="kpi-label">{label}</div>
      </div>
      <div className="kpi-mid">
        <div className="kpi-value" style={{ color: accent }}>{value}</div>
      </div>
      <div className="kpi-trend-sub" style={{ fontSize: 11 }}>{sub}</div>
    </div>
  );
}
