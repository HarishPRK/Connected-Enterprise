import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, CloudCog, Save, ServerCog, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useToast } from '../../ui/Toast';
import { createIdempotencyKey, saveControllerConfiguration } from './api';
import {
  CONTROLLER_BROKER_MAX_LENGTH,
  CONTROLLER_ENDPOINT_ID_MAX_LENGTH,
  CONTROLLER_PORT_MAX,
  CONTROLLER_PORT_MIN,
  CONTROLLER_TOPIC_MAX_LENGTH,
  controllerUspDraftFingerprint,
  controllerUspDraftFromProvisioning,
  validateControllerUspDraft,
  type ControllerUspDraft,
  type ControllerUspField,
} from './controllerUsp';
import type { ControllerConfiguration } from './types';

interface ControllerManagerProps {
  controller?: ControllerConfiguration;
  canConfigure: boolean;
  onControllerSaved: (controller: ControllerConfiguration) => void;
}

interface FormError {
  field?: ControllerUspField;
  message: string;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function shortChecksum(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export function ControllerManager({ controller, canConfigure, onControllerSaved }: ControllerManagerProps) {
  const { push } = useToast();
  const idPrefix = useId().replace(/:/g, '');
  const errorId = `${idPrefix}-error`;
  const persistedDraft = controllerUspDraftFromProvisioning(controller?.configuration);
  const persistedFingerprint = controllerUspDraftFingerprint(persistedDraft);
  const previousPersistedFingerprint = useRef(persistedFingerprint);
  const [draft, setDraft] = useState<ControllerUspDraft>(persistedDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FormError>();
  const [idempotencyKey, setIdempotencyKey] = useState(() => createIdempotencyKey('controller'));

  useEffect(() => {
    const previous = previousPersistedFingerprint.current;
    const nextDraft = controllerUspDraftFromProvisioning(controller?.configuration);
    setDraft((current) => controllerUspDraftFingerprint(current) === previous ? nextDraft : current);
    previousPersistedFingerprint.current = persistedFingerprint;
  }, [controller, persistedFingerprint]);

  const changed = controllerUspDraftFingerprint(draft) !== persistedFingerprint;
  const requiredFieldsPresent = Boolean(
    draft.controller_endpoint_id.trim()
    && draft.broker.trim()
    && draft.port.trim()
    && draft.controller_topic.trim(),
  );

  const inputId = (field: ControllerUspField) => `${idPrefix}-${field.replaceAll('_', '-')}`;
  const helpId = (field: ControllerUspField) => `${inputId(field)}-help`;
  const describedBy = (field: ControllerUspField) => (
    error?.field === field ? `${helpId(field)} ${errorId}` : helpId(field)
  );
  const invalid = (field: ControllerUspField) => error?.field === field;

  const updateDraft = (field: keyof ControllerUspDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(undefined);
    setIdempotencyKey(createIdempotencyKey('controller'));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canConfigure || saving) return;

    const validation = validateControllerUspDraft(draft);
    if ('error' in validation) {
      setError({ field: validation.field, message: validation.error });
      return;
    }

    const normalizedDraft = controllerUspDraftFromProvisioning(validation.provisioning);
    if (JSON.stringify(validation.provisioning) === JSON.stringify(controller?.configuration)) {
      setDraft(normalizedDraft);
      setError(undefined);
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const saved = await saveControllerConfiguration(validation.provisioning, idempotencyKey);
      const savedDraft = controllerUspDraftFromProvisioning(saved.configuration);
      setDraft(savedDraft);
      previousPersistedFingerprint.current = controllerUspDraftFingerprint(savedDraft);
      onControllerSaved(saved);
      setIdempotencyKey(createIdempotencyKey('controller'));
      push({
        kind: 'success',
        title: controller ? 'Controller configuration updated' : 'Controller configured',
        detail: 'Eligible gateway configuration pulls will receive the saved USP payload unchanged.',
      });
    } catch (cause) {
      setError({
        message: cause instanceof Error
          ? cause.message
          : 'Unable to save the Controller configuration. Try again.',
      });
    } finally {
      setSaving(false);
    }
  };

  const usp = controller?.configuration.usp;
  const savedPayload = controller ? JSON.stringify(controller.configuration, null, 2) : undefined;

  return (
    <section className="ce-onb-controller" aria-labelledby="controller-configuration-title">
      <div className="ce-onb-section-heading">
        <div>
          <h2 id="controller-configuration-title">Controller configuration</h2>
          <p>Provision the tenant-wide USP over MQTT payload returned when a gateway requests configuration through API Gateway.</p>
        </div>
        <span className="ce-onb-security-mark"><ShieldCheck size={16} aria-hidden="true" />Tenant configuration</span>
      </div>

      <div className="ce-onb-controller-layout">
        <div className="ce-onb-controller-workspace">
          <div className="ce-onb-panel-title">
            <span className="ce-onb-panel-icon"><ServerCog size={20} aria-hidden="true" /></span>
            <div>
              <h3>{controller ? 'Saved USP connection' : 'Configure a USP Controller'}</h3>
              <p>{controller
                ? 'These are the MQTT connection details currently stored for this tenant.'
                : 'Enter the Controller identity, MQTT broker, and concrete Controller topic.'}</p>
            </div>
            <span className="ce-onb-status" data-tone={controller ? 'ok' : 'neutral'}>
              <span aria-hidden="true" />{controller ? 'Configured' : 'Not configured'}
            </span>
          </div>

          {usp && controller && (
            <>
              <dl className="ce-onb-controller-facts">
                <div className="is-full">
                  <dt>Controller Endpoint ID</dt>
                  <dd className="mono" dir="ltr">{usp.controller_endpoint_id}</dd>
                </div>
                <div>
                  <dt>MTP</dt>
                  <dd>{usp.mtp}</dd>
                </div>
                <div>
                  <dt>Protocol</dt>
                  <dd>MQTT {usp.mqtt.protocol_version}</dd>
                </div>
                <div>
                  <dt>Transport</dt>
                  <dd>{usp.mqtt.transport}</dd>
                </div>
                <div className="is-wide">
                  <dt>Broker</dt>
                  <dd dir="ltr">{usp.mqtt.broker}</dd>
                </div>
                <div>
                  <dt>Port</dt>
                  <dd className="mono">{usp.mqtt.port}</dd>
                </div>
                <div className="is-full">
                  <dt>Controller topic</dt>
                  <dd className="mono" dir="ltr">{usp.mqtt.controller_topic}</dd>
                </div>
              </dl>
              <dl className="ce-onb-controller-record">
                <div>
                  <dt>Revision</dt>
                  <dd className="mono" title={controller.revision}>{controller.revision}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDateTime(controller.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Checksum</dt>
                  <dd className="mono" title={controller.configurationChecksum}>{shortChecksum(controller.configurationChecksum)}</dd>
                </div>
              </dl>
            </>
          )}

          {canConfigure ? (
            <form className="ce-onb-controller-form" onSubmit={submit} noValidate>
              <fieldset disabled={saving}>
                <legend className="ce-onb-sr-only">USP Controller settings</legend>

                <label className="is-full" htmlFor={inputId('controller_endpoint_id')}>
                  <span>Controller Endpoint ID</span>
                  <input
                    id={inputId('controller_endpoint_id')}
                    value={draft.controller_endpoint_id}
                    onChange={(event) => updateDraft('controller_endpoint_id', event.target.value)}
                    placeholder="proto::Controller-ip-172-31-2-12"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={CONTROLLER_ENDPOINT_ID_MAX_LENGTH}
                    aria-invalid={invalid('controller_endpoint_id')}
                    aria-describedby={describedBy('controller_endpoint_id')}
                  />
                  <small id={helpId('controller_endpoint_id')}>The USP Controller identity, up to {CONTROLLER_ENDPOINT_ID_MAX_LENGTH} UTF-8 bytes.</small>
                </label>

                <label htmlFor={inputId('mtp')}>
                  <span>MTP</span>
                  <input
                    id={inputId('mtp')}
                    className="ce-onb-controller-fixed"
                    value={draft.mtp}
                    readOnly
                    aria-readonly="true"
                    aria-invalid={invalid('mtp')}
                    aria-describedby={describedBy('mtp')}
                  />
                  <small id={helpId('mtp')}>Fixed for this provisioning flow.</small>
                </label>

                <label className="is-wide" htmlFor={inputId('broker')}>
                  <span>MQTT broker</span>
                  <input
                    id={inputId('broker')}
                    value={draft.broker}
                    onChange={(event) => updateDraft('broker', event.target.value)}
                    placeholder="broker.hivemq.com"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={CONTROLLER_BROKER_MAX_LENGTH}
                    aria-invalid={invalid('broker')}
                    aria-describedby={describedBy('broker')}
                  />
                  <small id={helpId('broker')}>Hostname or IPv4 address only; the port is entered separately.</small>
                </label>

                <label htmlFor={inputId('port')}>
                  <span>Broker port</span>
                  <input
                    id={inputId('port')}
                    type="number"
                    inputMode="numeric"
                    min={CONTROLLER_PORT_MIN}
                    max={CONTROLLER_PORT_MAX}
                    step={1}
                    value={draft.port}
                    onChange={(event) => updateDraft('port', event.target.value)}
                    required
                    aria-invalid={invalid('port')}
                    aria-describedby={describedBy('port')}
                  />
                  <small id={helpId('port')}>A whole number from {CONTROLLER_PORT_MIN} to {CONTROLLER_PORT_MAX}.</small>
                </label>

                <label htmlFor={inputId('protocol_version')}>
                  <span>Protocol version</span>
                  <input
                    id={inputId('protocol_version')}
                    className="ce-onb-controller-fixed"
                    value={draft.protocol_version}
                    readOnly
                    aria-readonly="true"
                    aria-invalid={invalid('protocol_version')}
                    aria-describedby={describedBy('protocol_version')}
                  />
                  <small id={helpId('protocol_version')}>MQTT protocol version 5.0.</small>
                </label>

                <label htmlFor={inputId('transport')}>
                  <span>Transport</span>
                  <input
                    id={inputId('transport')}
                    className="ce-onb-controller-fixed"
                    value={draft.transport}
                    readOnly
                    aria-readonly="true"
                    aria-invalid={invalid('transport')}
                    aria-describedby={describedBy('transport')}
                  />
                  <small id={helpId('transport')}>TCP/IP transport.</small>
                </label>

                <label className="is-full" htmlFor={inputId('controller_topic')}>
                  <span>Controller topic</span>
                  <input
                    id={inputId('controller_topic')}
                    value={draft.controller_topic}
                    onChange={(event) => updateDraft('controller_topic', event.target.value)}
                    placeholder="controller/proto::Controller-ip-172-31-2-12"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={CONTROLLER_TOPIC_MAX_LENGTH}
                    aria-invalid={invalid('controller_topic')}
                    aria-describedby={describedBy('controller_topic')}
                  />
                  <small id={helpId('controller_topic')}>A concrete MQTT topic without + or # wildcards, up to {CONTROLLER_TOPIC_MAX_LENGTH} UTF-8 bytes.</small>
                </label>
              </fieldset>

              {error && (
                <div id={errorId} className="ce-onb-alert is-error" role="alert">
                  <TriangleAlert size={17} aria-hidden="true" /><span>{error.message}</span>
                </div>
              )}

              <div className="ce-onb-controller-actions">
                <span>{controller
                  ? 'Saving creates the next tenant-wide Controller revision.'
                  : 'Saving makes this the tenant-wide Controller payload.'}</span>
                <button type="submit" className="primary" disabled={saving || !requiredFieldsPresent || !changed}>
                  {saving ? <span className="ce-onb-spinner" aria-hidden="true" /> : <Save size={15} aria-hidden="true" />}
                  {saving ? 'Saving…' : controller ? 'Update configuration' : 'Save configuration'}
                </button>
              </div>
            </form>
          ) : (
            <div className="ce-onb-controller-readonly" role="note">
              {controller ? <CheckCircle2 size={18} aria-hidden="true" /> : <TriangleAlert size={18} aria-hidden="true" />}
              <div>
                <strong>{controller ? 'Read-only access' : 'Configuration required'}</strong>
                <span>{controller
                  ? 'Tenant administrators can update these USP and MQTT settings.'
                  : 'Ask a tenant administrator to configure the USP Controller before enabling Controller mode.'}</span>
              </div>
            </div>
          )}
        </div>

        <aside className="ce-onb-controller-contract" aria-label="Gateway Controller response contract">
          <span><CloudCog size={22} aria-hidden="true" /></span>
          <h3>Gateway curl response</h3>
          <p>API Gateway returns the saved <code>{'{ usp: … }'}</code> object as the top-level JSON response body. This preview is formatted for readability.</p>
          {savedPayload ? (
            <pre aria-label="Formatted gateway response preview"><code>{savedPayload}</code></pre>
          ) : (
            <div className="ce-onb-controller-payload-empty">
              Save the USP Controller configuration to preview the gateway response structure here.
            </div>
          )}
          <small>No Connected Enterprise wrapper is added. The device receives compact JSON; revision, checksum, and update metadata remain in the console record. A gateway already applying or applied needs a new Deploy profile generation; the same profile version may be reused.</small>
        </aside>
      </div>
    </section>
  );
}
