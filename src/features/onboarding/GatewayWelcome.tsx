import { ArrowRight, ChevronDown, Cpu, FileLock2, MapPin, PackageCheck, ShieldCheck } from 'lucide-react';
import { currentProfiles } from './profileSelection';
import type { ProfileVersion, Site } from './types';

interface GatewayWelcomeProps {
  site?: Site;
  profiles: ProfileVersion[];
  canInitiate: boolean;
  localSimulator: boolean;
  onInitiate: () => void;
  onViewProfiles: () => void;
}

export function GatewayWelcome({ site, profiles, canInitiate, localSimulator, onInitiate, onViewProfiles }: GatewayWelcomeProps) {
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
          <h3>Add your first gateway</h3>
          <p>{site ? `${site.name} is ready for a gateway.` : 'Your gateway inventory is empty.'} Choose a profile, prepare the device, and follow its activation here.</p>
          <div className="ce-onb-welcome-actions">
            {canInitiate && <button type="button" className="primary" onClick={onInitiate}>
              Initiate Onboarding<ArrowRight size={16} aria-hidden="true" />
            </button>}
            <button type="button" className="ce-onb-link-button" onClick={onViewProfiles}>
              Browse profiles<ArrowRight size={14} aria-hidden="true" />
            </button>
          </div>
          {!canInitiate && <p className="ce-onb-welcome-permission">An administrator or operator can start gateway onboarding.</p>}
        </div>
        <figure className="ce-onb-topology" aria-label="The site and profile form a gateway package for activation">
          <svg viewBox="0 0 340 150" fill="none" aria-hidden="true">
            <path className="ce-onb-topology-track" d="M56 35H88Q100 35 100 47V61Q100 73 112 73H140M56 111H88Q100 111 100 99V85Q100 73 112 73M198 73H270" />
            <path className="ce-onb-topology-signal" d="M56 35H88Q100 35 100 47V61Q100 73 112 73H140M198 73H270" />
            <rect className="ce-onb-topology-node" x="16" y="15" width="40" height="40" rx="12" />
            <MapPin x="26" y="25" width="20" height="20" className="ce-onb-topology-site" />
            <text x="36" y="72" textAnchor="middle">Site</text>
            <rect className="ce-onb-topology-node" x="16" y="91" width="40" height="40" rx="12" />
            <FileLock2 x="26" y="101" width="20" height="20" className="ce-onb-topology-profile" />
            <text x="36" y="148" textAnchor="middle">Profile</text>
            <rect className="ce-onb-topology-core" x="140" y="44" width="58" height="58" rx="14" />
            {localSimulator
              ? <Cpu x="155" y="59" width="28" height="28" className="ce-onb-topology-package" />
              : <PackageCheck x="155" y="59" width="28" height="28" className="ce-onb-topology-package" />}
            <text x="169" y="122" textAnchor="middle">{localSimulator ? 'Gateway' : 'Package'}</text>
            <rect className="ce-onb-topology-node" x="270" y="53" width="40" height="40" rx="12" />
            <ShieldCheck x="280" y="63" width="20" height="20" className="ce-onb-topology-site" />
            <text x="290" y="113" textAnchor="middle">Activation</text>
            <path className="ce-onb-topology-arrow" d="m257 69 4 4-4 4" />
          </svg>
        </figure>
      </div>
      <div className="ce-onb-welcome-footer">
        <div className="ce-onb-welcome-profile"><FileLock2 size={16} aria-hidden="true" />
          <span>Latest profile <strong>{latestProfile ? `${latestProfile.name} · v${latestProfile.version}` : 'No profile available'}</strong></span>
        </div>
        <details className="ce-onb-welcome-guide">
          <summary>How onboarding works<ChevronDown size={14} aria-hidden="true" /></summary>
          <ol className="ce-onb-welcome-steps" aria-label="Gateway setup steps">
            {steps.map((step, index) => <li key={step.title}>
              <span aria-hidden="true">{index + 1}</span>
              <div><h4>{step.title}</h4><p>{step.detail}</p></div>
            </li>)}
          </ol>
        </details>
      </div>
    </div>
  );
}
