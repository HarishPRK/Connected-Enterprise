import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Cpu,
  FileLock2,
  Fingerprint,
  MapPin,
  PackageCheck,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { createIdempotencyKey, startOnboardingOperation, verifyFactorySerial } from './api';
import { ProfileParameterEditor } from './ProfileParameterEditor';
import type {
  GatewayModel,
  OnboardingOperation,
  ProfileVersion,
  VerificationResult,
} from './types';
import { profileVersionLabel, siteLabel } from './types';

interface OnboardingWizardProps {
  profiles: ProfileVersion[];
  models: GatewayModel[];
  preferredSiteId?: string;
  initialSerialNumber?: string;
  onCancel: () => void;
  onStarted: (operation: OnboardingOperation) => void;
}

const WIZARD_STEPS = [
  { id: 'verify', label: 'Gateway details' },
  { id: 'site', label: 'Assign site' },
  { id: 'profile', label: 'Select profile' },
  { id: 'review', label: 'Review & activate' },
] as const;

const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/;

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function compatibleProfiles(profiles: ProfileVersion[], modelId?: string): ProfileVersion[] {
  if (!modelId) return [];
  return profiles
    .filter((profile) => profile.modelId === modelId)
    .sort((a, b) => b.version - a.version || a.name.localeCompare(b.name));
}

export function OnboardingWizard({
  profiles,
  models,
  preferredSiteId,
  initialSerialNumber = '',
  onCancel,
  onStarted,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [serialNumber, setSerialNumber] = useState(initialSerialNumber);
  const [registrationModelId, setRegistrationModelId] = useState(models[0]?.id ?? '');
  const [verification, setVerification] = useState<VerificationResult>();
  const [siteId, setSiteId] = useState('');
  const [profileVersionId, setProfileVersionId] = useState('');
  const [verifyKey, setVerifyKey] = useState(() => createIdempotencyKey('verify'));
  const [operationKey, setOperationKey] = useState(() => createIdempotencyKey('activate'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);
  const model = verification ? modelById.get(verification.identity.modelId) : undefined;
  const availableProfiles = useMemo(
    () => compatibleProfiles(profiles, verification?.identity.modelId),
    [profiles, verification?.identity.modelId],
  );
  const selectedSite = verification?.allowedSites.find((site) => site.id === siteId);
  const selectedProfile = availableProfiles.find((profile) => profile.id === profileVersionId);

  const resetVerification = () => {
    setVerification(undefined);
    setSiteId('');
    setProfileVersionId('');
    setError(undefined);
    setVerifyKey(createIdempotencyKey('verify'));
    setOperationKey(createIdempotencyKey('activate'));
  };

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    const serial = serialNumber.trim().toUpperCase();
    if (serial && !SERIAL_PATTERN.test(serial)) {
      setError('Use 3–128 letters, numbers, hyphens, periods, or underscores, or leave the gateway ID blank to generate one.');
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const result = await verifyFactorySerial(serial, verifyKey, undefined, registrationModelId);
      const preferred = result.allowedSites.find((site) => site.id === preferredSiteId) ?? result.allowedSites[0];
      const profilesForDevice = compatibleProfiles(profiles, result.identity.modelId);
      setSerialNumber(result.identity.serialNumber);
      setVerification(result);
      setSiteId(preferred?.id ?? '');
      setProfileVersionId(profilesForDevice[0]?.id ?? '');
      setOperationKey(createIdempotencyKey('activate'));
      setStep(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to register this gateway. Check the ID and model.');
    } finally {
      setBusy(false);
    }
  };

  const startOperation = async () => {
    if (!verification || !selectedSite || !selectedProfile) {
      setError('Choose an authorized site and compatible immutable profile before activation.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const operation = await startOnboardingOperation(
        verification.verificationId,
        selectedSite.id,
        selectedProfile.id,
        operationKey,
      );
      onStarted(operation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start the onboarding operation.');
    } finally {
      setBusy(false);
    }
  };

  const goTo = (next: number) => {
    if (next < 0 || next > step || busy) return;
    setError(undefined);
    setStep(next);
  };

  return (
    <section className="ce-onb-wizard" aria-labelledby="onboarding-wizard-title">
      <div className="ce-onb-wizard-head">
        <div>
          <button type="button" className="ce-onb-text-button" onClick={onCancel} disabled={busy}>
            <ArrowLeft size={14} aria-hidden="true" />Gateway inventory
          </button>
          <h2 id="onboarding-wizard-title">Register a gateway</h2>
          <p>Add a real or mock gateway, choose its site, and assign a profile.</p>
        </div>
        <span className="ce-onb-security-mark"><ShieldCheck size={16} aria-hidden="true" />Authenticated registration</span>
      </div>

      <nav aria-label="Gateway activation progress" className="ce-onb-stepper">
        <ol>
          {WIZARD_STEPS.map((item, index) => (
            <li key={item.id} data-state={index < step ? 'complete' : index === step ? 'current' : 'upcoming'}>
              <button
                type="button"
                aria-current={index === step ? 'step' : undefined}
                onClick={() => goTo(index)}
                disabled={index > step || busy}
              >
                <span>{index < step ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
                <strong>{item.label}</strong>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {error && (
        <div className="ce-onb-alert is-error" role="alert">
          <TriangleAlert size={17} aria-hidden="true" /><span>{error}</span>
        </div>
      )}

      <div className="ce-onb-wizard-panel">
        {step === 0 && (
          <div className="ce-onb-wizard-split">
            <form className="ce-onb-verify-form" onSubmit={verify} noValidate>
              <div className="ce-onb-panel-title">
                <span className="ce-onb-panel-icon"><Fingerprint size={20} aria-hidden="true" /></span>
                <div>
                  <h3>Gateway details</h3>
                  <p>Choose your own ID or leave it blank to generate one. No factory inventory entry is required.</p>
                </div>
              </div>

              {verification ? (
                <div className="ce-onb-verified-identity">
                  <CheckCircle2 size={20} aria-hidden="true" />
                  <div>
                    <strong>{verification.identity.serialNumber} is reserved</strong>
                    <span>Reservation valid until {formatDateTime(verification.expiresAt)}</span>
                  </div>
                  <button type="button" onClick={resetVerification}>Use another gateway</button>
                </div>
              ) : (
                <fieldset disabled={busy}>
                  <legend className="ce-onb-sr-only">Gateway registration</legend>
                  <label>
                    <span>Gateway ID (optional)</span>
                    <input
                      value={serialNumber}
                      onChange={(event) => {
                        setSerialNumber(event.target.value.toUpperCase());
                        setError(undefined);
                        setVerifyKey(createIdempotencyKey('verify'));
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="For example, CE-GW-MCK-001"
                      aria-describedby="serial-help"
                      maxLength={128}
                    />
                    <small id="serial-help">Use this same ID on your real device or gateway simulator when connecting.</small>
                  </label>
                  <label>
                    <span>Gateway model</span>
                    <select
                      value={registrationModelId}
                      onChange={(event) => {
                        setRegistrationModelId(event.target.value);
                        setError(undefined);
                        setVerifyKey(createIdempotencyKey('verify'));
                      }}
                      aria-describedby="model-help"
                      required
                    >
                      <option value="" disabled>Choose a model</option>
                      {models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <small id="model-help">Used for new gateways. Existing gateways keep their registered model.</small>
                  </label>
                </fieldset>
              )}

              <div className="ce-onb-wizard-actions">
                <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
                {verification ? (
                  <button type="button" className="primary" onClick={() => setStep(1)}>
                    Continue <ArrowRight size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <button type="submit" className="primary" disabled={busy || !registrationModelId}>
                    {busy ? <span className="ce-onb-spinner" aria-hidden="true" /> : <Fingerprint size={15} aria-hidden="true" />}
                    {busy ? 'Saving…' : 'Continue to site'}
                  </button>
                )}
              </div>
            </form>

            <aside className="ce-onb-trust-panel" aria-label="Gateway registration information">
              <ShieldCheck size={24} aria-hidden="true" />
              <h3>Ready for real and mock devices</h3>
              <ul>
                <li>Custom or automatically generated gateway ID</li>
                <li>No preapproved serial or bootstrap certificate needed to register</li>
                <li>Site and profile selected from your tenant</li>
                <li>Device health appears after the gateway connects</li>
              </ul>
              <p>When ready to connect, an administrator can issue a bootstrap package for this ID from Bootstrap Packages. Use it on the real device or simulator.</p>
            </aside>
          </div>
        )}

        {step === 1 && verification && (
          <div className="ce-onb-choice-step">
            <div className="ce-onb-authoritative-device">
              <span className="ce-onb-panel-icon"><Cpu size={20} aria-hidden="true" /></span>
              <div>
                <small>Gateway ID</small>
                <strong>{verification.identity.serialNumber}</strong>
                <span>{model ? `${model.vendor} ${model.name}` : verification.identity.modelId}{verification.identity.hardwareRevision !== 'UNKNOWN' ? ` · hardware ${verification.identity.hardwareRevision}` : ''}</span>
              </div>
              <span className="ce-onb-status" data-tone="ok"><span aria-hidden="true" />Authorized</span>
            </div>

            <fieldset className="ce-onb-radio-grid">
              <legend>Assign a site</legend>
              <p>Choose where this gateway will be used.</p>
              {verification.allowedSites.length === 0 ? (
                <div className="ce-onb-alert is-warning"><TriangleAlert size={17} aria-hidden="true" />No sites are available. Ask a tenant administrator to add one.</div>
              ) : verification.allowedSites.map((site) => (
                <label key={site.id} className={siteId === site.id ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="onboarding-site"
                    value={site.id}
                    checked={siteId === site.id}
                    onChange={() => {
                      setSiteId(site.id);
                      setOperationKey(createIdempotencyKey('activate'));
                      setError(undefined);
                    }}
                  />
                  <span className="ce-onb-radio-icon"><MapPin size={17} aria-hidden="true" /></span>
                  <span><strong>{site.name}</strong><small>{site.location}</small></span>
                  <CheckCircle2 className="ce-onb-radio-check" size={18} aria-hidden="true" />
                </label>
              ))}
            </fieldset>

            <div className="ce-onb-wizard-actions">
              <button type="button" onClick={() => goTo(0)}><ArrowLeft size={14} aria-hidden="true" />Back</button>
              <button type="button" className="primary" onClick={() => { setError(undefined); setStep(2); }} disabled={!siteId}>
                Continue <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && verification && (
          <div className="ce-onb-profile-step">
            <div className="ce-onb-profile-choice-head">
              <div>
                <h3>Select an immutable profile</h3>
                <p>Only published versions compatible with {model?.name ?? verification.identity.modelId} are shown.</p>
              </div>
              <span className="ce-onb-security-mark"><FileLock2 size={15} aria-hidden="true" />Version locked</span>
            </div>

            {availableProfiles.length === 0 ? (
              <div className="ce-onb-empty-state is-compact">
                <span className="ce-onb-empty-icon"><FileLock2 size={23} aria-hidden="true" /></span>
                <h3>No compatible profile</h3>
                <p>Publish an immutable profile for model {verification.identity.modelId}, then return to this activation.</p>
              </div>
            ) : (
              <div className="ce-onb-profile-select-layout">
                <fieldset className="ce-onb-profile-radios">
                  <legend className="ce-onb-sr-only">Compatible profile versions</legend>
                  {availableProfiles.map((profile) => (
                    <label key={profile.id} className={profileVersionId === profile.id ? 'is-selected' : ''}>
                      <input
                        type="radio"
                        name="profile-version"
                        value={profile.id}
                        checked={profileVersionId === profile.id}
                        onChange={() => {
                          setProfileVersionId(profile.id);
                          setOperationKey(createIdempotencyKey('activate'));
                          setError(undefined);
                        }}
                      />
                      <span className="ce-onb-profile-lock"><FileLock2 size={16} aria-hidden="true" /></span>
                      <span>
                        <strong>{profile.name}</strong>
                        <small>Version {profile.version} · schema {profile.schemaVersion}</small>
                        <em>{profile.description}</em>
                      </span>
                      <span className="ce-onb-version-chip">v{profile.version}</span>
                    </label>
                  ))}
                </fieldset>

                {selectedProfile && (
                  <div className="ce-onb-selected-profile">
                    <div>
                      <strong>{profileVersionLabel(selectedProfile)}</strong>
                      <span className="mono" title={selectedProfile.contentHash}>{selectedProfile.contentHash.slice(0, 16)}…</span>
                    </div>
                    <ProfileParameterEditor values={selectedProfile.parameters} readOnly compact />
                  </div>
                )}
              </div>
            )}

            <div className="ce-onb-wizard-actions">
              <button type="button" onClick={() => goTo(1)}><ArrowLeft size={14} aria-hidden="true" />Back</button>
              <button type="button" className="primary" onClick={() => { setError(undefined); setStep(3); }} disabled={!selectedProfile}>
                Review assignment <ArrowRight size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && verification && selectedSite && selectedProfile && (
          <div className="ce-onb-review-step">
            <div className="ce-onb-review-intro">
              <span className="ce-onb-panel-icon"><PackageCheck size={20} aria-hidden="true" /></span>
              <div><h3>Ready to activate</h3><p>Confirm the gateway ID, site, and profile version.</p></div>
            </div>

            <dl className="ce-onb-review-grid">
              <div><dt>Gateway ID</dt><dd>{verification.identity.serialNumber}</dd><span>{model?.name ?? verification.identity.modelId}</span></div>
              <div><dt>Site</dt><dd>{siteLabel(selectedSite)}</dd><span>Assigned within your tenant</span></div>
              <div><dt>Profile version</dt><dd>{profileVersionLabel(selectedProfile)}</dd><span>Schema {selectedProfile.schemaVersion} · immutable</span></div>
              <div><dt>Reservation expires</dt><dd>{formatDateTime(verification.expiresAt)}</dd><span>Single-use reservation</span></div>
            </dl>

            <div className="ce-onb-activation-contract">
              <ShieldCheck size={20} aria-hidden="true" />
              <div>
                <strong>Success requires device confirmation</strong>
                <span>The operation completes only after operational mTLS reconnect, profile application, management-channel validation, and an <b>APPLIED_HEALTHY</b> acknowledgement.</span>
              </div>
            </div>

            <div className="ce-onb-wizard-actions">
              <button type="button" onClick={() => goTo(2)} disabled={busy}><ArrowLeft size={14} aria-hidden="true" />Back</button>
              <button type="button" className="primary" onClick={() => void startOperation()} disabled={busy}>
                {busy ? <span className="ce-onb-spinner" aria-hidden="true" /> : <PackageCheck size={15} aria-hidden="true" />}
                {busy ? 'Starting activation…' : 'Start activation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
