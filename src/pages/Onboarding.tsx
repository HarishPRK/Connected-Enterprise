import { OnboardingExperience } from '../features/onboarding/OnboardingExperience';
import { OnboardingAuthBoundary } from '../features/onboarding/OnboardingAuthBoundary';
import '../features/onboarding/onboarding.css';

export function OnboardingPage({ branchId }: { branchId: string }) {
  return (
    <OnboardingAuthBoundary>
      <OnboardingExperience preferredSiteId={branchId} />
    </OnboardingAuthBoundary>
  );
}
