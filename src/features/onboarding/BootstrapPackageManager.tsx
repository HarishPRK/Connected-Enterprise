import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileKey2,
  KeyRound,
  PackageCheck,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { createIdempotencyKey, generateBootstrapPackage } from './api';
import type { ProfileVersion, Site } from './types';

interface BootstrapPackageManagerProps {
  profiles: ProfileVersion[];
  sites: Site[];
  onIssued: () => Promise<void>;
  onVerifySerial: (serialNumber: string) => void;
}

interface IssuedPackage {
  serialNumber: string;
  certificateId: string;
  downloadUrl: string;
}

const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{2,127}$/;

function packageFileName(serialNumber: string): string {
  return `connected-enterprise-bootstrap-${serialNumber}.zip`;
}

function beginDownload(url: string, serialNumber: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = packageFileName(serialNumber);
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

export function BootstrapPackageManager({
  profiles,
  sites,
  onIssued,
  onVerifySerial,
}: BootstrapPackageManagerProps) {
  const [serialNumber, setSerialNumber] = useState('');
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [profileVersionId, setProfileVersionId] = useState('');
  const [requestKey, setRequestKey] = useState(() => createIdempotencyKey('bootstrap-package'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [issued, setIssued] = useState<IssuedPackage>();

  const compatibleProfiles = useMemo(
    () => [...profiles]
      .sort((a, b) => b.version - a.version || a.name.localeCompare(b.name)),
    [profiles],
  );
  const selectedProfileId = compatibleProfiles.some((profile) => profile.id === profileVersionId)
    ? profileVersionId
    : compatibleProfiles[0]?.id ?? '';
  const modelId = profiles.find((profile) => profile.id === selectedProfileId)?.modelId ?? '';
  const ready = SERIAL_PATTERN.test(serialNumber) && Boolean(modelId && siteId && selectedProfileId);

  useEffect(() => () => {
    if (issued?.downloadUrl) URL.revokeObjectURL(issued.downloadUrl);
  }, [issued?.downloadUrl]);

  const changed = () => {
    setError(undefined);
    setRequestKey(createIdempotencyKey('bootstrap-package'));
  };

  const issue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready) {
      setError('Enter a gateway ID and choose a site and profile.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await generateBootstrapPackage({
        serialNumber,
        modelId,
        siteId,
        profileVersionId: selectedProfileId,
        acknowledgeOneTimePrivateKey: true,
      }, requestKey);
      const downloadUrl = URL.createObjectURL(result.archive);
      setIssued({ serialNumber, certificateId: result.certificateId, downloadUrl });
      beginDownload(downloadUrl, serialNumber);
      await onIssued();
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : 'The package could not be issued. Check the serial inventory before trying again.');
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <section className="ce-onb-bootstrap" aria-labelledby="bootstrap-package-title">
        <div className="ce-onb-bootstrap-success" role="status" aria-live="polite">
          <span className="ce-onb-bootstrap-success-mark"><CheckCircle2 size={26} aria-hidden="true" /></span>
          <div>
            <h2 id="bootstrap-package-title">Bootstrap package issued</h2>
            <p>
              <strong>{issued.serialNumber}</strong> is ready to connect. Enrollment is prepared automatically.
              Copy the ZIP to the PC, real gateway, or simulator that will use this ID.
            </p>
          </div>
        </div>

        <dl className="ce-onb-bootstrap-result">
          <div><dt>Gateway ID</dt><dd>{issued.serialNumber}</dd></div>
          <div><dt>Certificate ID</dt><dd className="mono">{issued.certificateId}</dd></div>
          <div><dt>Package</dt><dd>{packageFileName(issued.serialNumber)}</dd></div>
        </dl>

        <div className="ce-onb-alert is-warning">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>Use the latest package for this gateway. Creating a replacement package retires the previous bootstrap certificate.</span>
        </div>

        <div className="ce-onb-bootstrap-actions">
          <button type="button" onClick={() => beginDownload(issued.downloadUrl, issued.serialNumber)}>
            <Download size={15} aria-hidden="true" />Download the same ZIP again
          </button>
          <button type="button" className="primary" onClick={() => onVerifySerial(issued.serialNumber)}>
            <PackageCheck size={15} aria-hidden="true" />Continue to gateway
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="ce-onb-bootstrap" aria-labelledby="bootstrap-package-title">
      <div className="ce-onb-section-heading">
        <div>
          <h2 id="bootstrap-package-title">Issue gateway bootstrap package</h2>
          <p>Download from any PC. Create or replace a package for your gateway; enrollment is prepared automatically.</p>
        </div>
        <span className="ce-onb-security-mark"><FileKey2 size={15} aria-hidden="true" />Administrator only</span>
      </div>

      {error && (
        <div className="ce-onb-alert is-error" role="alert">
          <TriangleAlert size={17} aria-hidden="true" /><span>{error}</span>
        </div>
      )}

      <div className="ce-onb-bootstrap-layout">
        <form className="ce-onb-bootstrap-form" onSubmit={(event) => void issue(event)} noValidate>
          <fieldset disabled={busy}>
            <legend className="ce-onb-sr-only">New gateway identity</legend>
            <label className="is-wide">
              <span>Gateway ID</span>
              <input
                value={serialNumber}
                onChange={(event) => {
                  setSerialNumber(event.target.value.trimStart().toUpperCase());
                  changed();
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="CE-GW-500-DAL-00043"
                maxLength={128}
                required
              />
              <small>Use the same ID on the device. An unused package can be replaced for this ID.</small>
            </label>

            <label>
              <span>Site</span>
              <select value={siteId} onChange={(event) => { setSiteId(event.target.value); changed(); }} required>
                {sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.location}</option>)}
              </select>
            </label>

            <label className="is-wide">
              <span>Profile</span>
              <select
                value={selectedProfileId}
                onChange={(event) => { setProfileVersionId(event.target.value); changed(); }}
                required
              >
                {compatibleProfiles.length === 0
                  ? <option value="">No compatible profile published</option>
                  : compatibleProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · v{profile.version} · schema {profile.schemaVersion}
                    </option>
                  ))}
              </select>
              <small>The gateway model is taken from the selected profile. Existing assignments keep their site and profile.</small>
            </label>
          </fieldset>

          <p>For a gateway that has not connected yet, a new download replaces its previous bootstrap package.</p>

          <div className="ce-onb-bootstrap-actions">
            <button type="submit" className="primary" disabled={busy || !ready}>
              {busy ? <span className="ce-onb-spinner" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
              {busy ? 'Preparing gateway…' : 'Create or replace package'}
            </button>
          </div>
        </form>

        <aside className="ce-onb-bootstrap-contract" aria-label="Package contents and safeguards">
          <span><KeyRound size={22} aria-hidden="true" /></span>
          <h3>Ready to connect</h3>
          <p>The package works from any PC for this gateway ID. Connect after downloading; no separate verification step is required.</p>
          <ul>
            <li>Bootstrap certificate and private key</li>
            <li>Amazon Root CA 1</li>
            <li>IoT, credentials-provider, and API endpoints</li>
            <li>Fleet template, role alias, model, site, and profile metadata</li>
          </ul>
          <small>No private key is written to DynamoDB, S3, application logs, or source control.</small>
        </aside>
      </div>
    </section>
  );
}
