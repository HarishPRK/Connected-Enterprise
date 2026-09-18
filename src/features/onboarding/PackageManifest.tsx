import { Check, ChevronDown, FileLock2, Fingerprint, MapPin, Package, ShieldCheck } from 'lucide-react';
import type { ProfileVersion, Site } from './types';

export function PackageManifest({ serialNumber, site, profile, ready }: {
  serialNumber: string; site?: Site; profile?: ProfileVersion; ready: boolean;
}) {
  return (
    <aside className="ce-onb-package-manifest" aria-label="Gateway package preview">
      <div className="ce-onb-manifest-title"><Package size={26} aria-hidden="true" /><span>Package preview</span></div>
      <h3>{serialNumber || 'Your next gateway'}</h3>
      <p>One package connects this device to its site and configuration.</p>
      <dl>
        <div><dt><Fingerprint size={17} aria-hidden="true" />Gateway identity</dt><dd>{serialNumber || 'Enter a gateway ID'}</dd></div>
        <div><dt><MapPin size={17} aria-hidden="true" />Assigned site</dt><dd>{site?.name ?? 'Choose a site'}<small>{site?.location}</small></dd></div>
        <div><dt><FileLock2 size={17} aria-hidden="true" />Configuration</dt><dd>{profile ? `${profile.name} · v${profile.version}` : 'Choose a profile'}<small>{profile?.modelId}</small></dd></div>
      </dl>
      <div className="ce-onb-manifest-readiness" data-ready={ready}>
        {ready ? <Check size={15} aria-hidden="true" /> : <Fingerprint size={15} aria-hidden="true" />}
        <span>{ready ? 'Ready to create your package' : 'Complete the setup to continue'}<small>Preview only · certificates have not been issued</small></span>
      </div>
      <details className="ce-onb-package-contents">
        <summary>Included files & device setup<ChevronDown size={14} aria-hidden="true" /></summary>
        <ul><li>Bootstrap certificate and private key</li><li>Amazon Root CA 1</li><li>IoT, credentials-provider, and API endpoints</li><li>Fleet template, role alias, model, site, and profile metadata</li></ul>
        <p>Keep the complete ZIP together. Verify and activate the gateway in this app, then use the package on the device.</p>
        <small><ShieldCheck size={13} aria-hidden="true" />No private key is written to DynamoDB, S3, application logs, or source control.</small>
      </details>
    </aside>
  );
}
