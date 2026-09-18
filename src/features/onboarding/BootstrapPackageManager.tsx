import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileKey2,
  KeyRound,
  PackageCheck,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { createIdempotencyKey, generateBootstrapPackage, startOnboardingOperation, verifyFactorySerial } from './api';
import {
  completeBootstrapRegistration,
  registrationFromMetadata,
  restoreRegistration,
  serializeRegistration,
  type BootstrapRegistration,
} from './bootstrapRegistration';
import { ProfilePreview } from './ProfilePreview';
import { selectableProfiles } from './profileSelection';
import type { OnboardingOperation, ProfileVersion, Site } from './types';

interface BootstrapPackageManagerProps {
  profiles: ProfileVersion[];
  sites: Site[];
  tenantId: string;
  resumeScope: string;
  canIssue: boolean;
  operations: OnboardingOperation[];
  preferredSiteId?: string;
  onIssued: () => Promise<void>;
  onOperation: (operation: OnboardingOperation) => void;
}

interface IssuedPackage extends BootstrapRegistration {
  downloadUrl?: string;
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
  tenantId,
  resumeScope,
  canIssue,
  operations,
  preferredSiteId,
  onIssued,
  onOperation,
}: BootstrapPackageManagerProps) {
  const [serialNumber, setSerialNumber] = useState('');
  const [siteId, setSiteId] = useState(
    () => sites.find((site) => site.id === preferredSiteId)?.id ?? sites[0]?.id ?? '',
  );
  const [profileVersionId, setProfileVersionId] = useState('');
  const [requestKey, setRequestKey] = useState(() => createIdempotencyKey('bootstrap-package'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const storageKey = `ce.onboarding.package.v1:${encodeURIComponent(tenantId)}:${encodeURIComponent(resumeScope)}`;
  const [issued, setIssued] = useState<IssuedPackage | undefined>(() => {
    try { return restoreRegistration(localStorage.getItem(storageKey), tenantId, createIdempotencyKey); }
    catch { return undefined; }
  });
  const [activating, setActivating] = useState(false);

  const compatibleProfiles = useMemo(
    () => selectableProfiles(profiles, profileVersionId),
    [profiles, profileVersionId],
  );
  const selectedProfileId = compatibleProfiles.some((profile) => profile.id === profileVersionId)
    ? profileVersionId
    : compatibleProfiles[0]?.id ?? '';
  const selectedProfile = compatibleProfiles.find((profile) => profile.id === selectedProfileId);
  const modelId = selectedProfile?.modelId ?? '';
  const ready = SERIAL_PATTERN.test(serialNumber) && Boolean(modelId && sites.some((site) => site.id === siteId) && selectedProfileId);

  useEffect(() => () => {
    if (issued?.downloadUrl) URL.revokeObjectURL(issued.downloadUrl);
  }, [issued?.downloadUrl]);

  const changed = () => {
    setError(undefined);
    setRequestKey(createIdempotencyKey('bootstrap-package'));
  };

  const saveProgress = (progress: BootstrapRegistration) => {
    setIssued((current) => ({ ...progress, downloadUrl: current?.downloadUrl }));
    try { localStorage.setItem(storageKey, serializeRegistration(progress)); }
    catch { /* The downloaded metadata file can restore the assignment if storage is unavailable. */ }
  };

  const openOperation = (operation: OnboardingOperation) => {
    try { localStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
    onOperation(operation);
  };

  const activate = async () => {
    if (!issued || activating) return;
    setActivating(true);
    setError(undefined);
    try {
      const existing = operations.find((operation) => operation.type === 'ONBOARD' && operation.serialNumber === issued.serialNumber);
      const operation = existing ?? await completeBootstrapRegistration(issued, {
        verify: (serial, key, model) => verifyFactorySerial(serial, key, undefined, model),
        activate: startOnboardingOperation,
        save: saveProgress,
        createKey: createIdempotencyKey,
        now: Date.now,
      });
      openOperation(operation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start activation. Try again with the same downloaded package.');
    } finally {
      setActivating(false);
    }
  };

  const restorePackage = async (file?: File) => {
    if (!file) return;
    setError(undefined);
    try {
      if (file.size > 32 * 1024) throw new Error('Choose bootstrap-metadata.json, not the ZIP or a certificate file.');
      let progress = registrationFromMetadata(JSON.parse(await file.text()), tenantId, createIdempotencyKey);
      if (!sites.some((site) => site.id === progress.siteId)
        || !profiles.some((profile) => profile.id === progress.profileVersionId && profile.modelId === progress.modelId)) {
        throw new Error('The package site or profile is unavailable in this tenant. Ask an administrator to check the assignment.');
      }
      try {
        const saved = restoreRegistration(localStorage.getItem(storageKey), tenantId, createIdempotencyKey);
        if (saved && saved.serialNumber === progress.serialNumber && saved.certificateId === progress.certificateId
          && saved.modelId === progress.modelId && saved.siteId === progress.siteId
          && saved.profileVersionId === progress.profileVersionId) progress = saved;
      } catch { /* Continue with the imported metadata when browser storage is unavailable. */ }
      saveProgress(progress);
    } catch (cause) {
      setError(cause instanceof SyntaxError ? 'Choose bootstrap-metadata.json from your downloaded ZIP.'
        : cause instanceof Error ? cause.message : 'Unable to read the package metadata.');
    }
  };

  const issue = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canIssue || !ready) {
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
      const progress = registrationFromMetadata({
        formatVersion: 1, tenantId, serialNumber, modelId, siteId,
        profileVersionId: selectedProfileId, certificateId: result.certificateId,
      }, tenantId, createIdempotencyKey);
      saveProgress(progress);
      setIssued({ ...progress, downloadUrl });
      beginDownload(downloadUrl, serialNumber);
      await onIssued();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The package could not be issued. Try again.';
      setError(message.includes('bootstrap private key cannot be downloaded again')
        ? 'A package already exists for this gateway. Use “Resume from a downloaded package” below and select its bootstrap-metadata.json file.'
        : message);
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    const assignedSite = sites.find((site) => site.id === issued.siteId);
    const assignedProfile = profiles.find((profile) => profile.id === issued.profileVersionId);
    const existingOperation = operations.find((operation) => operation.type === 'ONBOARD' && operation.serialNumber === issued.serialNumber);
    return (
      <section className="ce-onb-bootstrap" aria-labelledby="bootstrap-package-title">
        <button type="button" className="ce-onb-text-button" disabled={activating}
          onClick={() => { setIssued(undefined); setError(undefined); }}>
          <ArrowLeft size={14} aria-hidden="true" />Back to package setup
        </button>
        <div className="ce-onb-bootstrap-success" role="status" aria-live="polite">
          <span className="ce-onb-bootstrap-success-mark"><CheckCircle2 size={26} aria-hidden="true" /></span>
          <div>
            <h2 id="bootstrap-package-title">Complete gateway onboarding</h2>
            <p>
              <strong>{issued.serialNumber}</strong> has a bootstrap package.
              Verify and activate it with the site and profile selected for that package.
              Then connect the gateway using the downloaded ZIP.
            </p>
          </div>
        </div>

        <dl className="ce-onb-bootstrap-result">
          <div><dt>Gateway ID</dt><dd>{issued.serialNumber}</dd></div>
          <div><dt>Certificate ID</dt><dd className="mono">{issued.certificateId}</dd></div>
          <div><dt>Site</dt><dd>{assignedSite ? `${assignedSite.name} · ${assignedSite.location}` : issued.siteId}</dd></div>
          <div><dt>Profile</dt><dd>{assignedProfile ? `${assignedProfile.name} · v${assignedProfile.version}` : issued.profileVersionId}</dd></div>
          <div><dt>Package</dt><dd>{packageFileName(issued.serialNumber)}</dd></div>
        </dl>

        <div className="ce-onb-alert is-warning">
          <ShieldAlert size={17} aria-hidden="true" />
          <span>{issued.downloadUrl
            ? 'Keep this ZIP for the intended gateway. You can download it again while this page is open.'
            : 'Use the ZIP you already downloaded. The private key cannot be downloaded again after leaving the page.'}</span>
        </div>

        {error && <div className="ce-onb-alert is-error" role="alert"><TriangleAlert size={17} aria-hidden="true" /><span>{error}</span></div>}
        {assignedProfile && <ProfilePreview profile={assignedProfile} />}
        <p className="ce-onb-bootstrap-next-step">Your site and profile carry forward automatically. Activation progress will wait for the gateway to connect and report its status.</p>
        <div className="ce-onb-bootstrap-actions">
          {issued.downloadUrl && <button type="button" onClick={() => beginDownload(issued.downloadUrl!, issued.serialNumber)}>
            <Download size={15} aria-hidden="true" />Download the same ZIP again
          </button>}
          <button type="button" className="primary" disabled={activating} onClick={() => void activate()}>
            {activating ? <span className="ce-onb-spinner" aria-hidden="true" /> : <PackageCheck size={15} aria-hidden="true" />}
            {activating ? 'Starting activation…' : existingOperation ? 'View activation progress' : 'Verify device & activate'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="ce-onb-bootstrap" aria-labelledby="bootstrap-package-title">
      <div className="ce-onb-section-heading">
        <div>
          <h2 id="bootstrap-package-title">{canIssue ? 'Prepare gateway onboarding' : 'Continue gateway onboarding'}</h2>
          <p>{canIssue
            ? 'Choose the gateway, site, and profile once. Download its certificate package, then verify and activate the gateway.'
            : 'Use the metadata from a package downloaded by an administrator to verify and activate the gateway.'}</p>
        </div>
        {canIssue && <span className="ce-onb-security-mark"><FileKey2 size={15} aria-hidden="true" />Administrator only</span>}
      </div>

      {error && (
        <div className="ce-onb-alert is-error" role="alert">
          <TriangleAlert size={17} aria-hidden="true" /><span>{error}</span>
        </div>
      )}

      {canIssue && <div className="ce-onb-bootstrap-layout">
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
              <small>Use the same ID on the device. If you already downloaded a package for this ID, use that ZIP.</small>
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
              <small>The latest configuration is selected by default. Preview its settings below before creating the package.</small>
            </label>
          </fieldset>

          {selectedProfile && <ProfilePreview profile={selectedProfile} />}

          <div className="ce-onb-bootstrap-actions">
            <button type="submit" className="primary" disabled={busy || !ready}>
              {busy ? <span className="ce-onb-spinner" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
              {busy ? 'Preparing package…' : 'Create and download package'}
            </button>
          </div>
        </form>

        <aside className="ce-onb-bootstrap-contract" aria-label="Package contents and safeguards">
          <span><KeyRound size={22} aria-hidden="true" /></span>
          <h3>Use your downloaded package</h3>
          <p>You can transfer the ZIP between PCs. Complete gateway registration in this app before connecting the device.</p>
          <ul>
            <li>Bootstrap certificate and private key</li>
            <li>Amazon Root CA 1</li>
            <li>IoT, credentials-provider, and API endpoints</li>
            <li>Fleet template, role alias, model, site, and profile metadata</li>
          </ul>
          <small>No private key is written to DynamoDB, S3, application logs, or source control.</small>
        </aside>
      </div>}
      <details className="ce-onb-bootstrap-resume" open={!canIssue || undefined}>
        <summary>Resume from a downloaded package</summary>
        <p>Select <strong>bootstrap-metadata.json</strong> from your extracted ZIP. The site and profile are filled in from the package; the file stays in this browser.</p>
        <label>
          <span>Package metadata</span>
          <input type="file" accept=".json,application/json" onChange={(event) => {
            void restorePackage(event.target.files?.[0]);
            event.target.value = '';
          }} />
        </label>
      </details>
    </section>
  );
}
