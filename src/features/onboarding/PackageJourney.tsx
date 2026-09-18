import { Check, Cpu, Download, ShieldCheck } from 'lucide-react';

export function PackageJourney({ phase }: { phase: 'prepare' | 'activate' }) {
  const current = phase === 'prepare' ? 0 : 1;
  const steps = [
    { title: 'Prepare package', detail: 'Gateway, site & profile', icon: Download },
    { title: 'Verify & activate', detail: 'Confirm the assignment', icon: ShieldCheck },
    { title: 'Connect gateway', detail: 'Track delivery & health', icon: Cpu },
  ];
  return (
    <ol className="ce-onb-package-journey" aria-label="Onboarding progress">
      {steps.map(({ title, detail, icon: Icon }, index) => (
        <li key={title} data-state={index < current ? 'complete' : index === current ? 'current' : 'pending'}
          aria-current={index === current ? 'step' : undefined}>
          <span className="ce-onb-journey-mark">{index < current ? <Check size={18} aria-hidden="true" /> : <Icon size={18} aria-hidden="true" />}</span>
          <div><strong>{title}</strong><small>{detail}</small></div>
        </li>
      ))}
    </ol>
  );
}
