import { createContext, useContext } from 'react';
import type { OnboardingUser } from './auth';

export interface OnboardingAuthContextValue {
  user?: OnboardingUser;
  status: 'checking' | 'authenticated' | 'public' | 'anonymous' | 'error';
  authenticationRequired: boolean;
  authenticationError?: string;
  accessMode: 'checking' | 'cognito' | 'temporary-public-aws' | 'public-development-aws' | 'unavailable';
  signIn: () => void;
  signOut: () => void;
}

export const OnboardingAuthContext = createContext<OnboardingAuthContextValue>({
  status: 'authenticated', authenticationRequired: false, accessMode: 'cognito',
  signIn: () => undefined, signOut: () => undefined,
});

export function useOnboardingAuth(): OnboardingAuthContextValue {
  return useContext(OnboardingAuthContext);
}
