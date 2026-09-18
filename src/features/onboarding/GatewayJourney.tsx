import { useState } from 'react';
import { ArrowRight, Check, FileCheck2, Fingerprint, HeartPulse, Info, ShieldCheck } from 'lucide-react';
import type { GatewayJourney as Journey, JourneyStage } from './gatewayLifecycle';

const stageIcons = { registration: ShieldCheck, identity: Fingerprint, configuration: FileCheck2, validation: HeartPulse };
const stageLabels = { complete: 'Complete', current: 'In progress', pending: 'Waiting', attention: 'Needs attention', unconfirmed: 'Unconfirmed' };

export function GatewayJourney({ journey, onViewOperation }: { journey: Journey; onViewOperation?: () => void }) {
  const [inspected, setInspected] = useState<JourneyStage['id']>();
  const active = journey.stages.find(stage => stage.id === (inspected ?? journey.focus)) ?? journey.stages[0];
  const showingCurrent = active.id === journey.focus;
  return (
    <div className="ce-onb-journey">
      <div className="ce-onb-journey-heading">
        <h4>Activation map</h4>
        <span>Select a stage to inspect</span>
      </div>
      <ol className="ce-onb-stage-map" aria-label="Activation stages">
        {journey.stages.map((stage, index) => {
          const Icon = stageIcons[stage.id];
          return <li key={stage.id} data-state={stage.state}>
            <button type="button" aria-pressed={active.id === stage.id} onClick={() => setInspected(stage.id)}
              aria-label={`${stage.label}: ${stageLabels[stage.state]}`}>
              <span className="ce-onb-stage-symbol"><Icon size={23} aria-hidden="true" />
                {stage.state === 'complete' && <i><Check size={9} aria-hidden="true" /></i>}
              </span>
              <strong>{stage.label}</strong>
              <span className="ce-onb-stage-caption">{stageLabels[stage.state]}</span>
            </button>
            {index < journey.stages.length - 1 && <span className="ce-onb-stage-wire" aria-hidden="true" />}
          </li>;
        })}
      </ol>
      <div className="ce-onb-stage-briefing" data-tone={showingCurrent ? journey.group : active.state} aria-live="polite">
        <Info size={18} aria-hidden="true" />
        <div><strong>{showingCurrent ? journey.title : active.title}</strong>
          <p>{showingCurrent ? journey.detail : active.detail}</p>
        </div>
        {onViewOperation && <button type="button" className="ce-onb-link-button" onClick={onViewOperation}>
          View operation<ArrowRight size={14} aria-hidden="true" />
        </button>}
      </div>
    </div>
  );
}
