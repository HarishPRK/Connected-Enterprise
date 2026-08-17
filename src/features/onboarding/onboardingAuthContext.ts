import { createContext, useContext } from 'react';
import type { OnboardingUser } from './auth';

export interface OnboardingAuthContextValue {
  user?: OnboardingUser;
  signOut: () => void;
}

export const OnboardingAuthContext = createContext<OnboardingAuthContextValue>({ signOut: () => undefined });

export function useOnboardingAuth(): OnboardingAuthContextValue {
  return useContext(OnboardingAuthContext);
}
