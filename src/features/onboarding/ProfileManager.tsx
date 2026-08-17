import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileLock2, Plus, Search, ShieldCheck } from 'lucide-react';
import { useToast } from '../../ui/Toast';
import { createIdempotencyKey, createProfileVersion } from './api';
import { defaultProfileParameters, PROFILE_PARAMETERS } from './profileCatalog';
import { ProfileParameterEditor } from './ProfileParameterEditor';
import type { GatewayModel, ProfileParameterValue, ProfileVersion } from './types';

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

export function ProfileManager({ profiles, models, canPublish, onProfileCreated }: ProfileManagerProps) {
  const { push } = useToast();
  const [mode, setMode] = useState<'catalog' | 'create'>('catalog');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? '');
  const [baseId, setBaseId] = useState(profiles[0]?.id ?? '');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modelId, setModelId] = useState(models[0]?.id ?? '');
  const [changeNote, setChangeNote] = useState('');
  const [parameters, setParameters] = useState<Record<string, ProfileParameterValue>>(defaultProfileParameters);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey('profile'));

  const filteredProfiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return profiles
      .filter((profile) => !needle || profileSearchText(profile).includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [profiles, query]);

  const selected = profiles.find((profile) => profile.id === selectedId) ?? filteredProfiles[0];

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
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const profile = await createProfileVersion({
        name: name.trim(),
        description: description.trim(),
        modelId,
        baseProfileVersionId: baseId || undefined,
        parameters,
        changeNote: changeNote.trim(),
      }, idempotencyKey);
      onProfileCreated(profile);
      setSelectedId(profile.id);
      setMode('catalog');
      push({
        kind: 'success',
        title: `Published ${profile.name} v${profile.version}`,
        detail: 'The version is immutable and ready for gateway assignment.',
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
            <button type="button" className="ce-onb-text-button" onClick={() => setMode('catalog')}>
              <ArrowLeft size={14} aria-hidden="true" />Profile catalog
            </button>
            <h2>{baseId ? 'Publish a successor profile version' : 'Publish a new immutable profile'}</h2>
            <p>Only safe configuration and secret references are accepted. Existing versions are never edited in place.</p>
          </div>
          <span className="ce-onb-security-mark"><FileLock2 size={16} aria-hidden="true" />Immutable on publish</span>
        </div>

        {error && <div className="ce-onb-alert is-error" role="alert">{error}</div>}

        <fieldset className="ce-onb-profile-metadata" disabled={saving}>
          <legend className="ce-onb-sr-only">Profile version details</legend>
          <label>
            <span>Profile name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
          </label>
          <label>
            <span>Compatible gateway model</span>
            <select value={modelId} onChange={(event) => setModelId(event.target.value)} required disabled={Boolean(baseId)}>
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </label>
          <label className="is-wide">
            <span>Purpose</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} required maxLength={240} />
          </label>
          <label className="is-wide">
            <span>Change note</span>
            <input
              value={changeNote}
              onChange={(event) => setChangeNote(event.target.value)}
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
            <span>Credential fields accept references only. Passwords, private keys, claim material, and ownership tokens never enter this UI.</span>
          </div>
        </div>

        <ProfileParameterEditor
          values={parameters}
          onChange={(key, value) => {
            setParameters((current) => ({ ...current, [key]: value }));
            setError(undefined);
          }}
        />

        <div className="ce-onb-sticky-actions">
          <span>{baseId ? 'Publishing creates the next immutable version in this profile lineage.' : 'Publishing starts a new immutable profile lineage.'}</span>
          <div>
            <button type="button" onClick={() => setMode('catalog')} disabled={saving}>Cancel</button>
            <button type="submit" className="primary" disabled={saving || models.length === 0}>
              {saving ? <span className="ce-onb-spinner" aria-hidden="true" /> : <FileLock2 size={15} aria-hidden="true" />}
              {saving ? 'Publishing…' : 'Publish version'}
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
          <h2 id="profile-catalog-title">Immutable profile catalog</h2>
          <p>Review signed configuration versions or publish a successor. Assigned versions never mutate.</p>
        </div>
        {canPublish && (
          <button type="button" className="primary" onClick={() => beginCreate()} disabled={models.length === 0}>
            <Plus size={15} aria-hidden="true" />New profile
          </button>
        )}
      </div>

      {profiles.length === 0 ? (
        <div className="ce-onb-empty-state">
          <span className="ce-onb-empty-icon"><FileLock2 size={25} aria-hidden="true" /></span>
          <h3>No immutable profiles yet</h3>
          <p>Publish a model-compatible baseline before onboarding a gateway.</p>
          {canPublish && (
            <button type="button" className="primary" onClick={() => beginCreate()} disabled={models.length === 0}>
              <Plus size={15} aria-hidden="true" />Publish first version
            </button>
          )}
        </div>
      ) : (
        <div className="ce-onb-profile-layout">
          <div className="ce-onb-profile-catalog">
            <label className="ce-onb-search-field">
              <span className="ce-onb-sr-only">Search profiles</span>
              <Search size={15} aria-hidden="true" />
              <input type="search" value={query} placeholder="Search profiles…" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <div className="ce-onb-profile-list" aria-label="Profile versions">
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
                    <small>{profile.modelId} · version {profile.version}</small>
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
                  <span className="ce-onb-security-mark"><CheckCircle2 size={14} aria-hidden="true" />Immutable version</span>
                  <h3>{selected.name} <span>v{selected.version}</span></h3>
                  <p>{selected.description}</p>
                </div>
                {canPublish && <button type="button" onClick={() => beginCreate(selected)}><Plus size={14} aria-hidden="true" />New version</button>}
              </div>
              <dl className="ce-onb-profile-facts">
                <div><dt>Model</dt><dd>{selected.modelId}</dd></div>
                <div><dt>Schema</dt><dd>v{selected.schemaVersion}</dd></div>
                <div><dt>Published</dt><dd>{formatDate(selected.createdAt)}</dd></div>
                <div><dt>Content hash</dt><dd className="mono" title={selected.contentHash}>{shortHash(selected.contentHash)}</dd></div>
              </dl>
              <div className="ce-onb-profile-change-note"><strong>Change note</strong><span>{selected.changeNote}</span></div>
              <ProfileParameterEditor values={selected.parameters} readOnly compact />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
