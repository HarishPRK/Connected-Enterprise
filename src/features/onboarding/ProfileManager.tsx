import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileLock2, Pencil, Plus, Search, ShieldCheck } from 'lucide-react';
import { useToast } from '../../ui/Toast';
import { createIdempotencyKey, createProfileVersion } from './api';
import { defaultProfileParameters, PROFILE_PARAMETERS } from './profileCatalog';
import { ProfileParameterEditor } from './ProfileParameterEditor';
import { ProfileBlueprint } from './ProfileBlueprint';
import { currentProfiles, newestProfilesFirst } from './profileSelection';
import type { GatewayModel, ProfileParameterValue, ProfileVersion } from './types';
import { validateProfileControls } from './profileFormValidation';

interface ProfileManagerProps {
  profiles: ProfileVersion[];
  models: GatewayModel[];
  canPublish: boolean;
  onProfileCreated: (profile: ProfileVersion) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

function shortHash(value: string): string {
  if (!value) return 'Pending';
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function profileSearchText(profile: ProfileVersion): string {
  return `${profile.name} ${profile.description} ${profile.modelId} ${profile.version} ${profile.changeNote}`.toLowerCase();
}

function profileSubmissionParameters(
  parameters: Record<string, ProfileParameterValue>,
): Record<string, ProfileParameterValue> {
  const submitted = { ...parameters };
  if (submitted.wanMode !== 'STATIC') {
    delete submitted.wanStaticIpAddress;
    delete submitted.wanStaticPrefixLength;
    delete submitted.wanStaticGateway;
  }
  if (submitted.dhcpServerEnabled !== true) {
    delete submitted.dhcpPoolStart;
    delete submitted.dhcpPoolEnd;
    delete submitted.dhcpLeaseSeconds;
  }
  if (submitted.dnsMode !== 'STATIC') {
    delete submitted.dnsPrimaryServer;
    delete submitted.dnsSecondaryServer;
  } else if (String(submitted.dnsSecondaryServer ?? '').trim() === '') {
    delete submitted.dnsSecondaryServer;
  }
  if (String(submitted.dnsSearchDomain ?? '').trim() === '') delete submitted.dnsSearchDomain;
  return submitted;
}

export function ProfileManager({ profiles, models, canPublish, onProfileCreated }: ProfileManagerProps) {
  const { push } = useToast();
  const [mode, setMode] = useState<'catalog' | 'create'>('catalog');
  const [query, setQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [baseId, setBaseId] = useState(profiles[0]?.id ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [changeNote, setChangeNote] = useState('');
  const [parameters, setParameters] = useState<Record<string, ProfileParameterValue>>(defaultProfileParameters);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey('profile'));
  const changed = () => { setError(undefined); setIdempotencyKey(createIdempotencyKey('profile')); };

  const latestProfiles = useMemo(() => currentProfiles(profiles), [profiles]);
  const historicalCount = profiles.length - latestProfiles.length;
  const filteredProfiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return newestProfilesFirst(showHistory ? profiles : latestProfiles)
      .filter((profile) => !needle || profileSearchText(profile).includes(needle));
  }, [profiles, latestProfiles, query, showHistory]);

  const selected = filteredProfiles.find((profile) => profile.id === selectedId) ?? filteredProfiles[0];
  const selectedIsCurrent = latestProfiles.some((profile) => profile.id === selected?.id);

  const beginCreate = (base?: ProfileVersion) => {
    const source = base;
    setBaseId(source?.id ?? '');
    setName(source ? source.name : 'Branch secure baseline');
    setDescription(source?.description ?? 'Secure branch gateway baseline with transactional health rollback.');
    setModelId(source?.modelId ?? models[0]?.id ?? '');
    setChangeNote('');
    setParameters(source ? { ...defaultProfileParameters(), ...source.parameters } : defaultProfileParameters());
    setError(undefined);
    setIdempotencyKey(createIdempotencyKey('profile'));
    setMode('create');
  };

  const validate = (): string | undefined => {
    if (name.trim().length < 3) return 'Enter a profile name with at least 3 characters.';
    if (description.trim().length < 10) return 'Describe when operators should use this profile.';
    if (!models.some((model) => model.id === modelId)) return 'Select a supported gateway model.';
    if (changeNote.trim().length < 3) return 'Summarize what this immutable version changes.';
    const controlError = validateProfileControls(profileSubmissionParameters(parameters));
    if (controlError) return controlError;
    if (parameters.wanMode === 'STATIC'
      && (!String(parameters.wanStaticIpAddress ?? '').trim() || !String(parameters.wanStaticGateway ?? '').trim())) {
      return 'Enter the static WAN IP address and gateway before publishing.';
    }
    if (parameters.dhcpServerEnabled === true
      && (!String(parameters.dhcpPoolStart ?? '').trim() || !String(parameters.dhcpPoolEnd ?? '').trim())) {
      return 'Enter the DHCP pool start and end addresses before publishing.';
    }
    if (parameters.dnsMode === 'WAN_DHCP' && parameters.wanMode !== 'DHCP') {
      return 'Choose static DNS resolvers when the WAN does not use DHCP.';
    }
    if (parameters.dnsMode === 'STATIC' && !String(parameters.dnsPrimaryServer ?? '').trim()) {
      return 'Enter a primary DNS server for static resolver mode.';
    }
    const primaryNtp = String(parameters.ntpPrimaryServer ?? '').trim().toLowerCase();
    const secondaryNtp = String(parameters.ntpSecondaryServer ?? '').trim().toLowerCase();
    if (!primaryNtp || !secondaryNtp) return 'Enter both primary and secondary NTP servers.';
    if (primaryNtp === secondaryNtp) return 'Primary and secondary NTP servers must be different.';

    const invalidReference = PROFILE_PARAMETERS.find((parameter) => {
      if (parameter.control.kind !== 'secret-reference') return false;
      const value = String(parameters[parameter.key] ?? '').trim();
      return value !== '' && !value.startsWith('secretsmanager://') && !value.startsWith('arn:aws:secretsmanager:');
    });
    if (invalidReference) {
      return `${invalidReference.label} must be a secretsmanager:// reference or an AWS Secrets Manager ARN—never a secret value.`;
    }
    return undefined;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canPublish || saving) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const profile = await createProfileVersion({
        schemaVersion: 2,
        name: name.trim(),
        description: description.trim(),
        modelId,
        baseProfileVersionId: baseId || undefined,
        parameters: profileSubmissionParameters(parameters),
        changeNote: changeNote.trim(),
      }, idempotencyKey);
      onProfileCreated(profile);
      setSelectedId(profile.id);
      setMode('catalog');
      push({
        kind: 'success',
        title: `Saved ${profile.name} v${profile.version}`,
        detail: 'The new version is ready to select. Existing gateway assignments keep their current version.',
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to publish the profile version.');
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'create') {
    return (
      <form className="ce-onb-profile-create" onSubmit={submit} noValidate>
        <div className="ce-onb-section-heading">
          <div>
            <button type="button" className="ce-onb-text-button" disabled={saving} onClick={() => setMode('catalog')}>
              <ArrowLeft size={14} aria-hidden="true" />Profile catalog
            </button>
            <h2>{baseId ? 'Edit profile' : 'Create profile'}</h2>
            <p>Saving publishes a new version. Gateways already using this profile keep their assigned configuration.</p>
          </div>
          <span className="ce-onb-security-mark"><FileLock2 size={16} aria-hidden="true" />Immutable on publish</span>
        </div>

        {error && <div className="ce-onb-alert is-error" role="alert">{error}</div>}

        <fieldset className="ce-onb-profile-metadata" disabled={saving}>
          <legend className="ce-onb-sr-only">Profile version details</legend>
          <label>
            <span>Profile name</span>
            <input value={name} onChange={(event) => { setName(event.target.value); changed(); }} required maxLength={80} />
          </label>
          <label>
            <span>Compatible gateway model</span>
            <select value={modelId} onChange={(event) => { setModelId(event.target.value); changed(); }} required disabled={Boolean(baseId)}>
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label className="is-wide">
            <span>Purpose</span>
            <textarea value={description} onChange={(event) => { setDescription(event.target.value); changed(); }} rows={2} required maxLength={240} />
          </label>
          <label className="is-wide">
            <span>Change note</span>
            <input
              value={changeNote}
              onChange={(event) => { setChangeNote(event.target.value); changed(); }}
              placeholder="Example: Require management-loss rollback"
              required
              maxLength={160}
            />
          </label>
        </fieldset>

        <div className="ce-onb-secret-policy" role="note">
          <ShieldCheck size={18} aria-hidden="true" />
          <div>
            <strong>Secret-safe by design</strong>
            <span>Credential fields accept references only. Passwords, private keys, bootstrap credentials, and ownership tokens never enter this UI.</span>
          </div>
        </div>

        <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <ProfileParameterEditor
          values={parameters}
          onChange={(key, value) => {
            setParameters((current) => ({ ...current, [key]: value }));
            changed();
          }}
        />
        </fieldset>

        <div className="ce-onb-sticky-actions">
          <span>{baseId ? 'Your changes will be saved as the next version of this profile.' : 'Your first profile will be ready to use after saving.'}</span>
          <div>
            <button type="button" onClick={() => setMode('catalog')} disabled={saving}>Cancel</button>
            <button type="submit" className="primary" disabled={saving || models.length === 0}>
              {saving ? <span className="ce-onb-spinner" aria-hidden="true" /> : <FileLock2 size={15} aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <section className="ce-onb-profile-manager" aria-labelledby="profile-catalog-title">
      <div className="ce-onb-section-heading">
        <div>
          <h2 id="profile-catalog-title">Configuration profiles</h2>
          <p>Explore your latest configurations. Review a profile or publish its next version.</p>
        </div>
        {canPublish && selected && selectedIsCurrent && (
          <button type="button" className="primary" onClick={() => beginCreate(selected)} disabled={models.length === 0}>
            <Pencil size={15} aria-hidden="true" />Edit profile
          </button>
        )}
      </div>

      {profiles.length === 0 ? (
        <div className="ce-onb-empty-state">
          <span className="ce-onb-empty-icon"><FileLock2 size={25} aria-hidden="true" /></span>
          <h3>No profiles yet</h3>
          <p>Create a configuration for your gateway model before onboarding a device.</p>
          {canPublish && (
            <button type="button" className="primary" onClick={() => beginCreate()} disabled={models.length === 0}>
              <Plus size={15} aria-hidden="true" />Create profile
            </button>
          )}
        </div>
      ) : (
        <div className="ce-onb-profile-layout">
          <div className="ce-onb-profile-catalog">
            {historicalCount > 0 && (
              <label className="ce-onb-profile-history-toggle">
                <input type="checkbox" checked={showHistory}
                  onChange={(event) => { setShowHistory(event.target.checked); setSelectedId(''); }} />
                Show profile history ({historicalCount})
              </label>
            )}
            <label className="ce-onb-search-field">
              <span className="ce-onb-sr-only">Search profiles</span>
              <Search size={15} aria-hidden="true" />
              <input type="search" value={query} placeholder="Search profiles…" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="ce-onb-profile-list" aria-label={showHistory ? 'Profile history' : 'Latest profiles'}>
              {filteredProfiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  aria-pressed={selected?.id === profile.id}
                  className={selected?.id === profile.id ? 'is-selected' : ''}
                  onClick={() => setSelectedId(profile.id)}
                >
                  <span className="ce-onb-profile-lock"><FileLock2 size={16} aria-hidden="true" /></span>
                  <span>
                    <strong>{profile.name}</strong>
                    <small>{profile.modelId} · {latestProfiles.some((current) => current.id === profile.id) ? 'Latest version' : 'Historical version'} {profile.version}</small>
                  </span>
                  <span className="ce-onb-version-chip">v{profile.version}</span>
                </button>
              ))}
              {filteredProfiles.length === 0 && (
                <div className="ce-onb-inline-empty" role="status">No profiles match “{query.trim()}”.</div>
              )}
            </div>
          </div>

          {selected && (
            <div className="ce-onb-profile-detail">
              <div className="ce-onb-profile-detail-head">
                <div>
                  <h3>{selected.name} <span>v{selected.version}</span></h3>
                  <p>{selected.description}</p>
                </div>
                <span className="ce-onb-security-mark"><CheckCircle2 size={14} aria-hidden="true" />{selectedIsCurrent ? 'Latest version' : 'Historical version'}</span>
              </div>
              <dl className="ce-onb-profile-facts">
                <div><dt>Model</dt><dd>{selected.modelId}</dd></div>
                <div><dt>Schema</dt><dd>v{selected.schemaVersion}</dd></div>
                <div><dt>Published</dt><dd>{formatDate(selected.createdAt)}</dd></div>
                <div><dt>Content hash</dt><dd className="mono" title={selected.contentHash}>{shortHash(selected.contentHash)}</dd></div>
              </dl>
              <div className="ce-onb-profile-change-note"><strong>Change note</strong><span>{selected.changeNote}</span></div>
              <ProfileBlueprint profile={selected} />
              <ProfileParameterEditor values={selected.parameters} readOnly compact />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
