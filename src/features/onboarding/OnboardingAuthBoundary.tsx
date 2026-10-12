import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  beginOnboardingSignIn,
  completeOnboardingSignIn,
  currentOnboardingUser,
  onboardingAuthEnabled,
  onboardingConfigurationError,
  signOutOnboarding,
} from './auth';
import { OnboardingAuthContext, type OnboardingAuthContextValue } from './onboardingAuthContext';

// A StrictMode remount must reuse an in-flight single-use OAuth code exchange.
let pendingSignIn: Promise<boolean> | undefined;
function completeSignInOnce(): Promise<boolean> {
  pendingSignIn ??= completeOnboardingSignIn().finally(() => { pendingSignIn = undefined; });
  return pendingSignIn;
}

export function OnboardingAuthBoundary({ children }: { children: ReactNode }) {
  const configurationError = onboardingConfigurationError();
  const [state, setState] = useState<'checking' | 'authenticated' | 'anonymous' | 'error'>(
    configurationError ? 'error' : onboardingAuthEnabled ? 'checking' : 'authenticated',
  );
  const [error, setError] = useState(configurationError);
  const [user, setUser] = useState<OnboardingAuthContextValue['user']>();

  useEffect(() => {
    if (!onboardingAuthEnabled || configurationError) return;
    let cancelled = false;
    completeSignInOnce()
      .then((authenticated) => {
        if (cancelled) return;
        setUser(currentOnboardingUser());
        setState(authenticated ? 'authenticated' : 'anonymous');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'Cognito sign-in could not be completed.');
        setState('error');
      });
    return () => { cancelled = true; };
  }, [configurationError]);

  const signIn = useCallback(() => {
    setState('checking');
    setError(undefined);
    void beginOnboardingSignIn().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Unable to start sign-in.');
      setState('error');
    });
  }, []);
  const value = useMemo<OnboardingAuthContextValue>(() => ({
    user: state === 'authenticated' ? user : undefined,
    status: state,
    authenticationRequired: onboardingAuthEnabled || Boolean(configurationError),
    authenticationError: error,
    signIn,
    signOut: signOutOnboarding,
  }), [user, state, error, configurationError, signIn]);

  // The workspace stays visible while authorization is checked or requested.
  // Changing identity remounts its data hooks after a successful OAuth callback.
  return <OnboardingAuthContext.Provider key={value.user?.subject ?? 'anonymous'} value={value}>{children}</OnboardingAuthContext.Provider>;
}
