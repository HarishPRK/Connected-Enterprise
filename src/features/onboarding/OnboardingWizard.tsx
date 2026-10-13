import { useMemo, useRef, useState } from 'react';
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
import { createIdempotencyKey, startGatewaySimulator, startOnboardingOperation, verifyFactorySerial } from './api';
import { isManagedGatewaySerial } from './gatewayFlowPresentation';
import { ProfileParameterEditor } from './ProfileParameterEditor';
import type {
  GatewayModel,
  OnboardingOperation,
  ProfileVersion,
  VerificationResult,
} from './types';
import { profileVersionLabel, siteLabel } from './types';
import { currentProfiles, initialOnboardingAssignment, selectableProfiles } from './profileSelection';

interface OnboardingWizardProps {
  profiles: ProfileVersion[];
  models: GatewayModel[];
  preferredSiteId?: string;
  preferredProfileVersionId?: string;
  initialSerialNumber?: string;
  managedSimulator?: boolean;
  onCancel: () => void;
  onStarted: (operation: OnboardingOperation, flowError?: string) => void;
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

function compatibleProfiles(profiles: ProfileVersion[], modelId?: string, selectedId = ''): ProfileVersion[] {
  if (!modelId) return [];
  return selectableProfiles(profiles.filter((profile) => profile.modelId === modelId), selectedId);
}

export function OnboardingWizard({
  profiles,
  models,
  preferredSiteId,
  preferredProfileVersionId,
  initialSerialNumber = '',
  managedSimulator = false,
  onCancel,
  onStarted,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [serialNumber, setSerialNumber] = useState(() => initialSerialNumber || (managedSimulator
    ? `MOCK-${createIdempotencyKey('gateway').replace(/^ce-gateway-/, '').toUpperCase()}` : ''));
  const [verification, setVerification] = useState<VerificationResult>();
  const [siteId, setSiteId] = useState('');
  const [profileVersionId, setProfileVersionId] = useState('');
  const [verifyKey, setVerifyKey] = useState(() => createIdempotencyKey('verify'));
  const [operationKey, setOperationKey] = useState(() => createIdempotencyKey('activate'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const startingRef = useRef(false);

  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);
  const model = verification ? modelById.get(verification.identity.modelId) : undefined;
  const availableProfiles = useMemo(
    () => compatibleProfiles(profiles, verification?.identity.modelId, profileVersionId),
    [profiles, verification?.identity.modelId, profileVersionId],
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
    if (managedSimulator && !isManagedGatewaySerial(serial)) {
      setError('Use a gateway ID beginning with MOCK-, followed by 1–91 letters, numbers, hyphens, periods, or underscores.');
      return;
    }
    if (serial && !SERIAL_PATTERN.test(serial)) {
      setError('Use 3–128 letters, numbers, hyphens, periods, or underscores, or leave the gateway ID blank to generate one.');
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const result = await verifyFactorySerial(
        serial,
        verifyKey,
        undefined,
        profiles.find((profile) => profile.id === preferredProfileVersionId)?.modelId
          ?? currentProfiles(profiles)[0]?.modelId ?? models[0]?.id,
      );
      const assignment = initialOnboardingAssignment(profiles, result.identity.modelId, result.allowedSites, {
        siteId: preferredSiteId, profileVersionId: preferredProfileVersionId,
      });
      setSerialNumber(result.identity.serialNumber);
      setVerification(result);
      setSiteId(assignment.siteId);
      setProfileVersionId(assignment.profileVersionId);
      setOperationKey(createIdempotencyKey('activate'));
      setStep(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to register this gateway. Check the ID and try again.');
    } finally {
      setBusy(false);
    }
  };

  const startOperation = async () => {
    if (busy || startingRef.current) return;
    if (!verification || !selectedSite || !selectedProfile) {
      setError('Choose an authorized site and compatible immutable profile before activation.');
      return;
    }
    startingRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const operation = await startOnboardingOperation(
        verification.verificationId,
        selectedSite.id,
        selectedProfile.id,
        operationKey,
      );
      if (managedSimulator) {
        try {
          await startGatewaySimulator(operation.id, `ce-simulator-${operation.id}`);
        } catch (cause) {
          onStarted(operation, cause instanceof Error ? cause.message : 'The software gateway could not start. Review the operation and try INITIATE FLOW again.');
          return;
        }
      }
      onStarted(operation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start the onboarding operation.');
    } finally {
      startingRef.current = false;
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
          <h2 id="onboarding-wizard-title">{managedSimulator ? 'Simulate the onboarding flow' : 'Register a gateway'}</h2>
          <p>{managedSimulator ? 'Review the generated gateway ID, site, and profile, then select INITIATE FLOW. Follow registration, identity, configuration, and deployment confirmation as the service reports them. No ZIP upload is needed.' : 'Add a real or mock gateway, choose its site, and assign a profile.'}</p>
        </div>
        <span className="ce-onb-security-mark"><ShieldCheck size={16} aria-hidden="true" />{managedSimulator ? 'Authorized registration' : 'Authenticated registration'}</span>
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
                <strong>{managedSimulator && item.id === 'review' ? 'Review & initiate' : item.label}</strong>
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
                  <p>{managedSimulator ? 'Use the generated MOCK- ID or enter a new one. This identifies a software gateway running on the server.' : 'Choose your own ID or leave it blank to generate one. No factory inventory entry is required.'}</p>
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
                    <span>{managedSimulator ? 'Simulated gateway ID' : 'Gateway ID (optional)'}</span>
                    <input
                      value={serialNumber}
                      onChange={(event) => {
                        setSerialNumber(event.target.value.toUpperCase());
                        setError(undefined);
                        setVerifyKey(createIdempotencyKey('verify'));
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={managedSimulator ? 'MOCK-MCK-001' : 'For example, CE-GW-MCK-001'}
                      aria-describedby="serial-help"
                      maxLength={managedSimulator ? 96 : 128}
                      required={managedSimulator}
                    />
                    <small id="serial-help">{managedSimulator ? 'MOCK- IDs use the managed software-gateway flow. Choose a fresh ID for a new run.' : 'Use this same ID on your real device or gateway simulator when connecting.'}</small>
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
                  <button type="submit" className="primary" disabled={busy}>
                    {busy ? <span className="ce-onb-spinner" aria-hidden="true" /> : <Fingerprint size={15} aria-hidden="true" />}
                    {busy ? 'Saving…' : 'Continue to site'}
                  </button>
                )}
              </div>
            </form>

            <aside className="ce-onb-trust-panel" aria-label="Gateway registration information">
              <ShieldCheck size={24} aria-hidden="true" />
              <h3>{managedSimulator ? 'One action starts the flow' : 'Ready for real and mock devices'}</h3>
              <ul>
                <li>{managedSimulator ? 'A dedicated MOCK- gateway ID' : 'Custom or automatically generated gateway ID'}</li>
                <li>No preapproved serial or bootstrap certificate needed to register</li>
                <li>Site and profile selected from your tenant</li>
                <li>{managedSimulator ? 'Activation stages reflect the reported AWS operation' : 'Deployment confirmation appears after the gateway connects'}</li>
              </ul>
              <p>{managedSimulator ? 'The server prepares the connection credentials internally. AWS identity and configuration retrieval are live; device application is simulated.' : 'For a physical device, an administrator can issue its bootstrap package from Initiate Onboarding. Supported MOCK- gateways can use the managed Simulated gateway flow.'}</p>
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
                <h3>Select a profile</h3>
                <p>Latest configurations compatible with {model?.name ?? verification.identity.modelId}. Preview settings before continuing.</p>
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
              <div><h3>{managedSimulator ? 'Ready to initiate the flow' : 'Ready to activate'}</h3><p>Confirm the gateway ID, site, and profile version.</p></div>
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
                <span>{managedSimulator ? 'The server starts the software gateway and follows its reported stages. Completion requires confirmation from the onboarding service; applying the device configuration is simulated.' : 'The operation completes after the gateway reconnects with its operational identity, applies the assigned profile, and confirms configuration deployment.'}</span>
              </div>
            </div>

            <div className="ce-onb-wizard-actions">
              <button type="button" onClick={() => goTo(2)} disabled={busy}><ArrowLeft size={14} aria-hidden="true" />Back</button>
              <button type="button" className="primary" onClick={() => void startOperation()} disabled={busy}>
                {busy ? <span className="ce-onb-spinner" aria-hidden="true" /> : <PackageCheck size={15} aria-hidden="true" />}
                {busy ? managedSimulator ? 'INITIATING FLOW…' : 'Starting activation…' : managedSimulator ? 'INITIATE FLOW' : 'Start activation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
