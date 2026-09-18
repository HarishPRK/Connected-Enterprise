import type { ReactNode } from 'react';
import { ChevronDown, Clock3, Cpu, FileLock2, MapPin, Settings2, ShieldCheck } from 'lucide-react';
import { GatewayJourney } from './GatewayJourney';
import type { GatewayJourney as Journey } from './gatewayLifecycle';
import type { Gateway, GatewayModel, OnboardingOperation, ProfileVersion, Site } from './types';

function timestamp(value?: string) {
  if (!value) return 'Not reported';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

interface GatewayDetailProps {
  gateway: Gateway;
  model?: GatewayModel;
  site?: Site;
  profile?: ProfileVersion;
  desiredProfile?: ProfileVersion;
  operation?: OnboardingOperation;
  journey: Journey;
  status: { label: string; tone: string; title?: string };
  pullConfirmed: boolean;
  actions: ReactNode;
  management?: ReactNode;
  onViewProfiles: () => void;
}

export function GatewayDetail({ gateway, model, site, profile, desiredProfile, operation, journey, status,
  pullConfirmed, actions, management, onViewProfiles }: GatewayDetailProps) {
  const recentEvents = [...(operation?.timeline ?? [])].slice(-2).reverse();
  return (
    <article className="ce-onb-gateway-detail" aria-label={`Gateway ${gateway.serialNumber}`}>
      <header className="ce-onb-device-header">
        <span className="ce-onb-device-symbol"><Cpu size={27} aria-hidden="true" /></span>
        <div className="ce-onb-device-heading">
          <div><h3>{gateway.serialNumber}</h3>
            <span className="ce-onb-status" data-tone={status.tone} title={status.title}>
              <span aria-hidden="true" />{status.label}
            </span>
          </div>
          <p>{model?.name ?? gateway.modelId}<span>Generation {gateway.deploymentGeneration}</span></p>
        </div>
        <div className="ce-onb-device-actions">{actions}</div>
      </header>

      <GatewayJourney key={`${gateway.id}:${gateway.deploymentGeneration}`} journey={journey} />

      <div className="ce-onb-device-context">
        <section aria-label="Gateway assignment">
          <h4>Assignment</h4>
          <dl>
            <div><dt><MapPin size={14} aria-hidden="true" />Site</dt>
              <dd>{site?.name ?? gateway.siteId}<small>{site?.location}</small></dd></div>
            <div><dt><FileLock2 size={14} aria-hidden="true" />{pullConfirmed ? 'Assigned profile' : 'Applied profile'}</dt>
              <dd>{profile ? `${profile.name} · v${profile.version}` : 'Not applied yet'}
                {desiredProfile && desiredProfile.id !== profile?.id && <small>Selected: {desiredProfile.name} · v{desiredProfile.version}</small>}
                <button type="button" className="ce-onb-link-button" onClick={onViewProfiles}>Browse configuration profiles</button>
              </dd></div>
            <div><dt><ShieldCheck size={14} aria-hidden="true" />Certificate</dt>
              <dd>{gateway.certificateState.charAt(0) + gateway.certificateState.slice(1).toLowerCase()}</dd></div>
          </dl>
        </section>
        <section aria-label="Recent gateway activity">
          <h4>Recent activity</h4>
          {recentEvents.length > 0 ? <ol className="ce-onb-activity-log">
            {recentEvents.map((event, index) => <li key={`${event.state}:${event.at}:${index}`}>
              <span aria-hidden="true" />
              <div><p>{event.detail || event.state.replace(/_/g, ' ').toLowerCase()}</p>
                <time dateTime={event.at}>{timestamp(event.at)}</time></div>
            </li>)}
          </ol> : <p className="ce-onb-activity-empty">No operation events reported for this generation.</p>}
          <div className="ce-onb-last-seen"><Clock3 size={14} aria-hidden="true" />
            <span>Last seen <strong>{timestamp(gateway.lastSeenAt)}</strong></span></div>
        </section>
      </div>

      <footer className="ce-onb-device-footer">
        <span>Hardware <strong>{gateway.hardwareRevision === 'UNKNOWN' ? 'Not reported' : gateway.hardwareRevision}</strong></span>
        <span className="mono" title={gateway.thingName}>{gateway.thingName}</span>
      </footer>
      {management && <details className="ce-onb-device-management">
        <summary><Settings2 size={14} aria-hidden="true" />Gateway management<ChevronDown size={14} aria-hidden="true" /></summary>
        <div><p>Retire this gateway or reset its registration. Each action requires serial-number confirmation.</p>
          <div>{management}</div></div>
      </details>}
    </article>
  );
}
