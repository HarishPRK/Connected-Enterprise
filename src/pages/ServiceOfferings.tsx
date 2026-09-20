import type { ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { SolutionShowcase } from '../components/offerings/SolutionShowcase';
import {
  Activity, ArrowLeftRight, ArrowRight, Boxes, Cloud, GitBranch, Layers3, Leaf, Package,
  Radio, Sparkles, Zap,
} from 'lucide-react';

/* ─────────── Solution Offerings
 * Edge / Enterprise Gateway "smart services" — each capability ships as a
 * container (+ libraries) on the gateway's prplLCM container runtime and is
 * exposed northbound through consumer-facing APIs. Content mirrors the
 * "Digital Enterprise ecosystem readiness" architecture slide. */

interface Offering {
  id: string;
  container: number;           // position on the gateway (Container 1..8)
  name: string;
  ml: boolean;                 // ships with ML libraries
  icon: ComponentType<{ size?: number }>;
  accent: string;              // css var string
  rgbVar: string;              // matching -rgb token for tints
  capabilities: string[];
}

const OFFERINGS: Offering[] = [
  {
    id: 'interoperability', container: 1, name: 'Interoperability', ml: true,
    icon: ArrowLeftRight, accent: 'var(--accent)', rgbVar: '--accent-rgb',
    capabilities: [
      'Conversion of various industry protocols (OPC-UA, MQTT, Modbus, BACnet)',
    ],
  },
  {
    id: 'eagle', container: 2, name: 'EA:GLE — Edge Analytics', ml: true,
    icon: Activity, accent: 'var(--accent-3)', rgbVar: '--accent-3-rgb',
    capabilities: [
      'Real-time data processing on the edge',
      'Predictive analytics with self-healing',
    ],
  },
  {
    id: 'dynamic-failover', container: 3, name: 'Dynamic Failover', ml: true,
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
    id: 'greengrass', container: 4, name: 'AWS Greengrass', ml: false,
    icon: Cloud, accent: 'var(--warn)', rgbVar: '--warn-rgb',
    capabilities: [
      'Local edge data processing',
      'Interface with AWS Cloud for device onboarding / provisioning',
      'Remote device management',
    ],
  },
  {
    id: 'matter', container: 5, name: 'Matter', ml: true,
    icon: Boxes, accent: 'var(--accent-2)', rgbVar: '--accent-2-rgb',
    capabilities: [
      'Enterprise automation',
      'Enterprise safety',
      'Remote monitoring & control',
    ],
  },
  {
    id: 'thread-border-router', container: 6, name: 'Thread Border Router', ml: false,
    icon: Radio, accent: 'var(--accent-2)', rgbVar: '--accent-2-rgb',
    capabilities: [
      'Thread mesh backbone for Matter devices',
      'Enterprise automation, safety, and remote monitoring & control',
    ],
  },
  {
    id: 'energy-prediction', container: 7, name: 'Energy Prediction', ml: true,
    icon: Zap, accent: 'var(--warn)', rgbVar: '--warn-rgb',
    capabilities: [
      'Monitoring, prediction and preventive maintenance of energy-consuming appliances',
      'Anomaly detection — machine-learning based solution',
    ],
  },
  {
    id: 'sustainability', container: 8, name: 'Sustainability', ml: true,
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
];

const STACK: { group: string; note: string; items: string[] }[] = [
  { group: 'Solution layer', note: 'Consumer-facing capabilities', items: ['Edge Analytics', 'AI / ML', 'Generative AI', 'Agentic AI', 'Matter', 'OpenThread'] },
  { group: 'Standards & protocols', note: 'Interoperability foundation', items: ['MQTT', 'Modbus', 'OPC UA', 'BACnet', 'PROFINET', 'Node-RED'] },
  { group: 'Connectivity', note: 'Wireless + wired transport', items: ['Wi-Fi 7', '5G', 'Fiber', 'Thread', 'LoRaWAN', 'Bluetooth'] },
  { group: 'OS platforms', note: 'Gateway operating environment', items: ['Linux', 'OpenWrt'] },
  { group: 'Silicon', note: 'Hardware foundation', items: ['MaxLinear', 'Quectel', 'Silicon Labs'] },
];

export function ServiceOfferingsPage() {
  const mlCount = OFFERINGS.filter((o) => o.ml).length;

  return (
    <div className="service-offerings-page">
      <PageHeader
        title="Solution Offerings"
        subtitle='Edge / enterprise gateway "smart services" — containerized capabilities for the Digital Enterprise ecosystem, delivered through consumer-facing APIs.'
        right={<span className="badge ok"><span className="dot ok" />{OFFERINGS.length}/{OFFERINGS.length} available</span>}
      />

      <SolutionShowcase />

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
            title="Smart services on the edge / enterprise gateway"
            sub="Each offering runs as an isolated container with its libraries — consumed from above through APIs, managed below by prplLCM."
            right={
              <div className="so-brand-lockup">
                <img src="/capgemini.jpg" alt="Capgemini" />
                <span>Capgemini</span>
              </div>
            }
          >
            {/* Architecture sandwich mirrors the slide: APIs on top, containers
                in the middle, the prplLCM runtime underneath. */}
            <div className="so-arch-band">Consumer-facing APIs</div>
            <div className="so-grid">
              {OFFERINGS.map((o) => <OfferingCard key={o.id} o={o} />)}
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
            title="Gateway technology stack"
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
    </div>
  );
}

/* ─────────── Offering card ─────────── */

function OfferingCard({ o }: { o: Offering }) {
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
        Container {o.container} · + libraries{o.ml ? ' (ML)' : ''}
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
