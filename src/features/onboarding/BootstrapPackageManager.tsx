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
import type { GatewayModel, ProfileVersion, Site } from './types';

interface BootstrapPackageManagerProps {
  models: GatewayModel[];
  profiles: ProfileVersion[];
  sites: Site[];
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
  models,
  profiles,
  sites,
  onVerifySerial,
}: BootstrapPackageManagerProps) {
  const initialModelId = models[0]?.id ?? '';
  const [serialNumber, setSerialNumber] = useState('');
  const [modelId, setModelId] = useState(initialModelId);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [profileVersionId, setProfileVersionId] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [requestKey, setRequestKey] = useState(() => createIdempotencyKey('bootstrap-package'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [issued, setIssued] = useState<IssuedPackage>();

  const compatibleProfiles = useMemo(
    () => profiles
      .filter((profile) => profile.modelId === modelId)
      .sort((a, b) => b.version - a.version || a.name.localeCompare(b.name)),
    [modelId, profiles],
  );
  const selectedProfileId = compatibleProfiles.some((profile) => profile.id === profileVersionId)
    ? profileVersionId
    : compatibleProfiles[0]?.id ?? '';
  const ready = SERIAL_PATTERN.test(serialNumber)
    && Boolean(modelId && siteId && selectedProfileId)
    && acknowledged;

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
      setError('Complete the serial binding and confirm the one-time private-key requirement.');
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
              <strong>{issued.serialNumber}</strong> is now registered and bound to one unique AWS IoT certificate.
              The private key exists only in the ZIP returned to this browser.
            </p>
          </div>
        </div>

        <dl className="ce-onb-bootstrap-result">
          <div><dt>Factory serial</dt><dd>{issued.serialNumber}</dd></div>
          <div><dt>Certificate ID</dt><dd className="mono">{issued.certificateId}</dd></div>
          <div><dt>Package</dt><dd>{packageFileName(issued.serialNumber)}</dd></div>
        </dl>

        <div className="ce-onb-alert is-warning">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>Move the ZIP into protected gateway storage now. Leaving this page removes the browser’s fallback download; AWS cannot recover the private key.</span>
        </div>

        <div className="ce-onb-bootstrap-actions">
          <button type="button" onClick={() => beginDownload(issued.downloadUrl, issued.serialNumber)}>
            <Download size={15} aria-hidden="true" />Download the same ZIP again
          </button>
          <button type="button" className="primary" onClick={() => onVerifySerial(issued.serialNumber)}>
            <PackageCheck size={15} aria-hidden="true" />Continue to gateway verification
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
          <p>Create one lab bootstrap identity, bind it to a new factory serial, and download the only private-key copy.</p>
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
              <span>Factory serial number</span>
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
              <small>The serial becomes the permanent one-to-one inventory binding.</small>
            </label>

            <label>
              <span>Gateway model</span>
              <select
                value={modelId}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setProfileVersionId('');
                  changed();
                }}
                required
              >
                {models.map((model) => <option key={model.id} value={model.id}>{model.vendor} · {model.name}</option>)}
              </select>
            </label>

            <label>
              <span>Authorized site</span>
              <select value={siteId} onChange={(event) => { setSiteId(event.target.value); changed(); }} required>
                {sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.location}</option>)}
              </select>
            </label>

            <label className="is-wide">
              <span>Initial profile eligibility</span>
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
              <small>The onboarding wizard may use this model-compatible immutable version.</small>
            </label>
          </fieldset>

          <label className="ce-onb-bootstrap-acknowledgement">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => { setAcknowledged(event.target.checked); changed(); }}
              disabled={busy}
            />
            <span>
              <strong>I understand the private key is available only in this response.</strong>
              <small>I will place the ZIP in the intended gateway’s protected storage and will not reuse or commit it.</small>
            </span>
          </label>

          <div className="ce-onb-bootstrap-actions">
            <button type="submit" className="primary" disabled={busy || !ready}>
              {busy ? <span className="ce-onb-spinner" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
              {busy ? 'Issuing and binding…' : 'Create and download package'}
            </button>
          </div>
        </form>

        <aside className="ce-onb-bootstrap-contract" aria-label="Package contents and safeguards">
          <span><KeyRound size={22} aria-hidden="true" /></span>
          <h3>One request, one device</h3>
          <p>The server creates an active certificate, attaches only the bootstrap policy, and atomically binds it to this serial.</p>
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
