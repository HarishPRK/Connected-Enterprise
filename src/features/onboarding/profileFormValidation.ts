import { PROFILE_PARAMETERS } from './profileCatalog';
import type { ProfileParameterValue } from './types';

export function validateProfileControls(parameters: Record<string, ProfileParameterValue>): string | undefined {
  for (const parameter of PROFILE_PARAMETERS) {
    const value = parameters[parameter.key];
    if (value === undefined) continue; // Inactive WAN/DHCP/DNS fields are removed before submission.
    const control = parameter.control;
    if (control.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${parameter.label} requires a number.`;
      if (control.min !== undefined && value < control.min) return `${parameter.label} must be at least ${control.min}.`;
      if (control.max !== undefined && value > control.max) return `${parameter.label} must be at most ${control.max}.`;
      const step = control.step ?? 1;
      const steps = (value - (control.min ?? 0)) / step;
      if (Math.abs(steps - Math.round(steps)) > 1e-8) return `${parameter.label} must use increments of ${step}.`;
    }
    if (control.kind === 'boolean' && typeof value !== 'boolean') return `${parameter.label} must be enabled or disabled.`;
    if (control.kind === 'select' && !control.options.some((option) => option.value === value)) return `Choose a supported ${parameter.label.toLowerCase()}.`;
  }
  return undefined;
}
