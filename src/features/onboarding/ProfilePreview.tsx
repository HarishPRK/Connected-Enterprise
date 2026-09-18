import { useId, useState } from 'react';
import { ChevronDown, Eye } from 'lucide-react';
import { ProfileParameterEditor } from './ProfileParameterEditor';
import type { ProfileVersion } from './types';

export function ProfilePreview({ profile }: { profile: ProfileVersion }) {
  const panelId = useId();
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="ce-onb-inline-preview" aria-label="Selected profile preview">
      <div className="ce-onb-inline-preview-heading">
        <div>
          <strong>{profile.name} · v{profile.version}</strong>
          <p>{profile.description}</p>
          <small>{profile.modelId} · Published {new Date(profile.createdAt).toLocaleDateString()}</small>
        </div>
        <button type="button" aria-expanded={expanded} aria-controls={panelId}
          onClick={() => setExpanded(!expanded)}>
          <Eye size={15} aria-hidden="true" />{expanded ? 'Hide preview' : 'Preview configuration'}
          <ChevronDown size={14} aria-hidden="true" className={expanded ? 'is-expanded' : ''} />
        </button>
      </div>
      <div id={panelId} hidden={!expanded} className="ce-onb-inline-preview-settings">
        {expanded && <ProfileParameterEditor key={profile.id} values={profile.parameters} readOnly compact />}
      </div>
    </section>
  );
}
