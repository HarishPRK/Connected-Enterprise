import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  beginOnboardingSignIn,
  completeOnboardingSignIn,
  currentOnboardingUser,
  discoverOnboardingAccessMode,
  ONBOARDING_ACCESS_EXPIRED_EVENT,
  onboardingAuthEnabled,
  onboardingConfigurationError,
  signOutOnboarding,
} from './auth';
import { OnboardingAuthContext, type OnboardingAuthContextValue } from './onboardingAuthContext';

type AccessState = Omit<OnboardingAuthContextValue, 'signIn' | 'signOut'>;

async function initializeAccess(): Promise<AccessState> {
  let access;
  try {
    access = await discoverOnboardingAccessMode();
  } catch (cause) {
    return {
      accessMode: 'unavailable', status: 'error', authenticationRequired: false,
      authenticationError: cause instanceof Error ? cause.message : 'Unable to confirm onboarding access.',
    };
  }
  if (access.mode === 'temporary-public-aws') {
    return { accessMode: access.mode, status: 'authenticated', authenticationRequired: false, user: access.user };
  }
  const configurationError = onboardingConfigurationError();
  if (configurationError) {
    return { accessMode: 'cognito', status: 'error', authenticationRequired: true, authenticationError: configurationError };
  }
  try {
    const authenticated = await completeOnboardingSignIn();
    return {
      accessMode: 'cognito', status: authenticated ? 'authenticated' : 'anonymous',
      authenticationRequired: onboardingAuthEnabled, user: authenticated ? currentOnboardingUser() : undefined,
    };
  } catch (cause) {
    return {
      accessMode: 'cognito', status: 'error', authenticationRequired: onboardingAuthEnabled,
      authenticationError: cause instanceof Error ? cause.message : 'Sign-in could not be completed.',
    };
  }
}

// StrictMode remounts share mode discovery and any single-use OAuth code exchange.
let pendingInitialization: Promise<AccessState> | undefined;
function initializeAccessOnce(): Promise<AccessState> {
  pendingInitialization ??= initializeAccess().finally(() => { pendingInitialization = undefined; });
  return pendingInitialization;
}

export function OnboardingAuthBoundary({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<AccessState>({
    accessMode: 'checking', status: 'checking', authenticationRequired: false,
  });

  useEffect(() => {
    let cancelled = false;
    void initializeAccessOnce().then((next) => { if (!cancelled) setAccess(next); });
    const onAccessExpired = (event: Event) => {
      const message = (event as CustomEvent<unknown>).detail;
      setAccess((current) => ({
        ...current, user: undefined, status: 'error', authenticationRequired: false,
        authenticationError: typeof message === 'string' ? message : 'Temporary live onboarding access has expired.',
      }));
    };
    window.addEventListener(ONBOARDING_ACCESS_EXPIRED_EVENT, onAccessExpired);
    return () => {
      cancelled = true;
      window.removeEventListener(ONBOARDING_ACCESS_EXPIRED_EVENT, onAccessExpired);
    };
  }, []);

  const signIn = useCallback(() => {
    setAccess((current) => ({ ...current, status: 'checking', authenticationError: undefined }));
    void beginOnboardingSignIn().catch((cause: unknown) => {
      setAccess((current) => ({
        ...current, status: 'error',
        authenticationError: cause instanceof Error ? cause.message : 'Unable to start sign-in.',
      }));
    });
  }, []);
  const value = useMemo<OnboardingAuthContextValue>(() => ({
    ...access, user: access.status === 'authenticated' ? access.user : undefined,
    signIn, signOut: signOutOnboarding,
  }), [access, signIn]);

  // New access modes/identities remount data hooks after server validation.
  return <OnboardingAuthContext.Provider key={`${access.accessMode}:${value.user?.subject ?? 'anonymous'}`} value={value}>{children}</OnboardingAuthContext.Provider>;
}
