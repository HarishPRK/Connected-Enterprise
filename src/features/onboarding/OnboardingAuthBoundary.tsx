import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LogIn, ShieldAlert, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import {
  beginOnboardingSignIn,
  completeOnboardingSignIn,
  currentOnboardingUser,
  onboardingAuthEnabled,
  onboardingConfigurationError,
  signOutOnboarding,
} from './auth';
import { OnboardingAuthContext, type OnboardingAuthContextValue } from './onboardingAuthContext';

export function OnboardingAuthBoundary({ children }: { children: ReactNode }) {
  const configurationError = onboardingConfigurationError();
  const [state, setState] = useState<'checking' | 'authenticated' | 'anonymous' | 'error'>(
    onboardingAuthEnabled ? 'checking' : configurationError ? 'error' : 'authenticated',
  );
  const [error, setError] = useState(configurationError);
  const [user, setUser] = useState<OnboardingAuthContextValue['user']>();

  useEffect(() => {
    if (!onboardingAuthEnabled || configurationError) return;
    let cancelled = false;
    completeOnboardingSignIn()
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

  const value = useMemo<OnboardingAuthContextValue>(() => ({ user, signOut: signOutOnboarding }), [user]);

  if (state === 'authenticated') return <OnboardingAuthContext.Provider value={value}>{children}</OnboardingAuthContext.Provider>;

  return (
    <div className="ce-onb-page">
      <PageHeader
        title="Gateway Onboarding"
        subtitle="Verify hardware identity, assign immutable profiles, and confirm device health."
      />
      <section className="ce-onb-auth-gate" aria-labelledby="onboarding-auth-title">
        <span className={`ce-onb-auth-mark${state === 'error' ? ' is-error' : ''}`}>
          {state === 'error' ? <ShieldAlert size={28} aria-hidden="true" /> : <ShieldCheck size={28} aria-hidden="true" />}
        </span>
        <h2 id="onboarding-auth-title">
          {state === 'checking' ? 'Confirming your onboarding session' : state === 'error' ? 'Onboarding sign-in needs attention' : 'Sign in to manage gateway identity'}
        </h2>
        <p>
          {state === 'checking'
            ? 'Completing the Cognito authorization-code exchange and tenant claim validation…'
            : error ?? 'Cognito verifies your identity; the API derives tenant and role from signed token claims.'}
        </p>
        {state === 'checking' ? (
          <span className="ce-onb-spinner" aria-label="Checking sign-in" />
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => {
              setState('checking');
              setError(undefined);
              void beginOnboardingSignIn().catch((cause: unknown) => {
                setError(cause instanceof Error ? cause.message : 'Unable to start Cognito sign-in.');
                setState('error');
              });
            }}
          >
            <LogIn size={16} aria-hidden="true" />{state === 'error' ? 'Start a fresh sign-in' : 'Sign in with Cognito'}
          </button>
        )}
        <small>No claim certificates, private keys, activation codes, or AWS credentials are stored in the browser session.</small>
      </section>
    </div>
  );
}
