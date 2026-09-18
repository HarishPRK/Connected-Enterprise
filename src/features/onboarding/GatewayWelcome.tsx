import { ArrowRight, Cpu, Download, FileLock2, MapPin, PackageCheck, ShieldCheck } from 'lucide-react';
import { currentProfiles } from './profileSelection';
import type { ProfileVersion, Site } from './types';

interface GatewayWelcomeProps {
  site?: Site;
  sites: Site[];
  profiles: ProfileVersion[];
  canInitiate: boolean;
  localSimulator: boolean;
  onInitiate: () => void;
  onViewProfiles: () => void;
}

export function GatewayWelcome({ site, sites, profiles, canInitiate, localSimulator, onInitiate, onViewProfiles }: GatewayWelcomeProps) {
  const latestProfile = currentProfiles(profiles)[0];
  const steps = localSimulator ? [
    { title: 'Verify the gateway', detail: 'Confirm the device identity in the simulator.' },
    { title: 'Choose a configuration', detail: 'Assign a site and preview the profile.' },
    { title: 'Follow activation', detail: 'Track configuration delivery and device health.' },
  ] : [
    { title: 'Choose a configuration', detail: 'Select a site and preview the gateway profile.' },
    { title: 'Download the package', detail: 'Keep the certificates and metadata together.' },
    { title: 'Activate & connect', detail: 'Verify the gateway, then connect with your package.' },
  ];
  return (
    <div className="ce-onb-welcome">
      <div className="ce-onb-welcome-main">
        <div className="ce-onb-welcome-copy">
          <h3>Your next gateway<br /><em>starts here.</em></h3>
          <p>No gateways are assigned {site ? `to ${site.name}` : 'yet'}. Bring a device into your network and follow its journey from identity to configuration.</p>
          <div className="ce-onb-welcome-actions">
            {canInitiate && <button type="button" className="primary" onClick={onInitiate}>
              Initiate Onboarding<ArrowRight size={18} aria-hidden="true" />
            </button>}
            <button type="button" className="ce-onb-link-button" onClick={onViewProfiles}>
              Explore profiles<ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
          {!canInitiate && <p className="ce-onb-welcome-permission">An administrator or operator can start gateway onboarding.</p>}
        </div>
        <figure className="ce-onb-topology">
          <svg viewBox="0 0 440 270" fill="none" aria-hidden="true">
            <path className="ce-onb-topology-track" d="M84 70H130Q148 70 148 88V116Q148 135 169 135H192M84 200H130Q148 200 148 182V154Q148 135 169 135M278 135H356" />
            <path className="ce-onb-topology-signal" d="M84 70H130Q148 70 148 88V116Q148 135 169 135H192M278 135H356" />
            <rect className="ce-onb-topology-node" x="28" y="42" width="56" height="56" rx="16" />
            <MapPin x="45" y="59" width="22" height="22" className="ce-onb-topology-site" />
            <text x="56" y="122" textAnchor="middle">Site</text>
            <rect className="ce-onb-topology-node" x="28" y="172" width="56" height="56" rx="16" />
            <FileLock2 x="45" y="189" width="22" height="22" className="ce-onb-topology-profile" />
            <text x="56" y="252" textAnchor="middle">Profile</text>
            <rect className="ce-onb-topology-core" x="192" y="92" width="86" height="86" rx="16" />
            {localSimulator
              ? <Cpu x="216" y="116" width="38" height="38" className="ce-onb-topology-package" />
              : <PackageCheck x="216" y="116" width="38" height="38" className="ce-onb-topology-package" />}
            <text x="235" y="203" textAnchor="middle">{localSimulator ? 'Gateway' : 'Gateway package'}</text>
            <rect className="ce-onb-topology-node" x="356" y="107" width="56" height="56" rx="16" />
            <ShieldCheck x="373" y="124" width="22" height="22" className="ce-onb-topology-site" />
            <text x="384" y="187" textAnchor="middle">Activation</text>
            <path className="ce-onb-topology-arrow" d="m345 130 5 5-5 5" />
          </svg>
          <figcaption>{localSimulator ? 'A configured identity for every gateway' : 'One package. Your site, profile, and device identity.'}</figcaption>
        </figure>
      </div>
      <ol className="ce-onb-welcome-steps" aria-label="Gateway setup steps">
        {steps.map((step, index) => <li key={step.title}>
          <span aria-hidden="true">{index + 1}</span>
          <div><h4>{step.title}</h4><p>{step.detail}</p></div>
        </li>)}
      </ol>
      <div className="ce-onb-welcome-context">
        <div><MapPin size={18} aria-hidden="true" /><span><small>{site ? 'Current site' : 'Authorized sites'}</small>
          <strong>{site ? `${site.name} · ${site.location}` : sites.length ? `${sites.length} sites available` : 'No sites available'}</strong></span></div>
        <div><FileLock2 size={18} aria-hidden="true" /><span><small>Latest profile</small>
          <strong>{latestProfile ? `${latestProfile.name} · v${latestProfile.version}` : 'Create a profile to get started'}</strong></span></div>
        <div><Download size={18} aria-hidden="true" /><span><small>{localSimulator ? 'Onboarding mode' : 'Package contents'}</small>
          <strong>{localSimulator ? 'Local simulator' : 'Certificates + configuration metadata'}</strong></span></div>
      </div>
    </div>
  );
}
