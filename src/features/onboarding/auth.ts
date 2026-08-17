const SESSION_KEY = 'ce.onboarding.auth.session';
const OAUTH_STATE_KEY = 'ce.onboarding.auth.state';
const PKCE_VERIFIER_KEY = 'ce.onboarding.auth.pkce';

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface StoredSession {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface OnboardingUser {
  subject: string;
  email?: string;
  tenantId?: string;
  tenantRole?: string;
}

export class OnboardingAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnboardingAuthenticationError';
  }
}

function cleanBase(value: string | undefined): string {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

const apiBaseUrl = cleanBase(import.meta.env.VITE_ONBOARDING_API_URL);
const cognitoDomain = cleanBase(import.meta.env.VITE_ONBOARDING_COGNITO_DOMAIN);
const cognitoClientId = String(import.meta.env.VITE_ONBOARDING_COGNITO_CLIENT_ID ?? '').trim();
const redirectUri = String(
  import.meta.env.VITE_ONBOARDING_REDIRECT_URI
    ?? `${window.location.origin}/onboarding`,
).trim();
const logoutUri = String(
  import.meta.env.VITE_ONBOARDING_LOGOUT_URI
    ?? `${window.location.origin}/onboarding`,
).trim();

export const onboardingAuthEnabled = Boolean(cognitoDomain && cognitoClientId);
export const onboardingUsesRemoteApi = Boolean(apiBaseUrl);

function secureBrowserUrl(value: string, allowPath = true): boolean {
  try {
    const parsed = new URL(value);
    const loopbackHttp = parsed.protocol === 'http:'
      && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    return (parsed.protocol === 'https:' || loopbackHttp)
      && !parsed.username
      && !parsed.password
      && !parsed.hash
      && (allowPath || (parsed.pathname === '/' && !parsed.search));
  } catch {
    return false;
  }
}

export function onboardingConfigurationError(): string | undefined {
  if (!onboardingUsesRemoteApi && !cognitoDomain && !cognitoClientId) return undefined;
  if (!apiBaseUrl) return 'VITE_ONBOARDING_API_URL is required when Cognito onboarding authentication is enabled.';
  if (!cognitoDomain) return 'VITE_ONBOARDING_COGNITO_DOMAIN is required for the AWS onboarding API.';
  if (!cognitoClientId) return 'VITE_ONBOARDING_COGNITO_CLIENT_ID is required for the AWS onboarding API.';
  if (!secureBrowserUrl(apiBaseUrl)) {
    return 'The onboarding API URL must use HTTPS outside local development.';
  }
  if (!secureBrowserUrl(cognitoDomain, false)) {
    return 'The Cognito domain must be an HTTPS origin without credentials, query parameters, or fragments.';
  }
  if (!secureBrowserUrl(redirectUri)) {
    return 'The onboarding OAuth redirect URI must use HTTPS outside local development.';
  }
  if (!secureBrowserUrl(logoutUri)) {
    return 'The onboarding OAuth logout URI must use HTTPS outside local development.';
  }
  return undefined;
}

export function onboardingApiUrl(path: string): string {
  return `${apiBaseUrl}${path}`;
}

export function onboardingSseEnabled(): boolean {
  return !onboardingUsesRemoteApi && import.meta.env.VITE_ONBOARDING_DISABLE_SSE !== 'true';
}

function randomUrlSafe(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function readSession(): StoredSession | undefined {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const session = JSON.parse(raw) as StoredSession;
    if (!session.idToken || !session.accessToken || !Number.isFinite(session.expiresAt)) return undefined;
    return session;
  } catch {
    return undefined;
  }
}

function writeSession(tokens: TokenResponse, previousRefreshToken?: string): StoredSession {
  const session: StoredSession = {
    idToken: tokens.id_token,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previousRefreshToken,
    expiresAt: Date.now() + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function tokenRequest(parameters: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(`${cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: parameters,
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new OnboardingAuthenticationError('Cognito could not complete the sign-in. Start a fresh sign-in and try again.');
  }
  const tokens = await response.json() as Partial<TokenResponse>;
  if (!tokens.id_token || !tokens.access_token || !tokens.expires_in) {
    throw new OnboardingAuthenticationError('Cognito returned an incomplete token response.');
  }
  return tokens as TokenResponse;
}

async function refreshedSession(session: StoredSession): Promise<StoredSession | undefined> {
  if (!session.refreshToken) return undefined;
  try {
    const tokens = await tokenRequest(new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cognitoClientId,
      refresh_token: session.refreshToken,
    }));
    return writeSession(tokens, session.refreshToken);
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return undefined;
  }
}

async function activeSession(): Promise<StoredSession | undefined> {
  const session = readSession();
  if (!session) return undefined;
  if (session.expiresAt - Date.now() > 60_000) return session;
  return refreshedSession(session);
}

export async function onboardingAuthorizationHeaders(): Promise<Record<string, string>> {
  if (!onboardingAuthEnabled) return {};
  const session = await activeSession();
  if (!session) throw new OnboardingAuthenticationError('Your onboarding session has expired. Sign in again.');
  // Use the OAuth access token as the API bearer credential. Cognito's V2
  // pre-token hook adds the tenant claims to both tokens; the ID token remains
  // browser-only display identity and is never used to authorize API calls.
  return { Authorization: `Bearer ${session.accessToken}` };
}

export async function beginOnboardingSignIn(): Promise<void> {
  const issue = onboardingConfigurationError();
  if (issue) throw new OnboardingAuthenticationError(issue);
  const verifier = randomUrlSafe(48);
  const state = randomUrlSafe(24);
  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(OAUTH_STATE_KEY, state);
  const query = new URLSearchParams({
    client_id: cognitoClientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    state,
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
  });
  window.location.assign(`${cognitoDomain}/oauth2/authorize?${query.toString()}`);
}

export async function completeOnboardingSignIn(): Promise<boolean> {
  if (!onboardingAuthEnabled) return true;
  const url = new URL(window.location.href);
  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    const description = url.searchParams.get('error_description') ?? oauthError;
    clearOAuthAttempt();
    removeOAuthQuery(url);
    throw new OnboardingAuthenticationError(`Cognito sign-in was not completed: ${description}`);
  }
  const code = url.searchParams.get('code');
  if (!code) return Boolean(await activeSession());
  const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY);
  const presentedState = url.searchParams.get('state');
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  if (!expectedState || !presentedState || expectedState !== presentedState || !verifier) {
    clearOAuthAttempt();
    removeOAuthQuery(url);
    throw new OnboardingAuthenticationError('The sign-in response did not match this browser session. Start again.');
  }
  const tokens = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cognitoClientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }));
  writeSession(tokens);
  clearOAuthAttempt();
  removeOAuthQuery(url);
  return true;
}

function clearOAuthAttempt(): void {
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);
}

function removeOAuthQuery(url: URL): void {
  ['code', 'state', 'error', 'error_description'].forEach((key) => url.searchParams.delete(key));
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

function decodeClaims(token: string): Record<string, unknown> {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return {};
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    return JSON.parse(atob(normalized)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function currentOnboardingUser(): OnboardingUser | undefined {
  if (!onboardingAuthEnabled) return undefined;
  const session = readSession();
  if (!session || session.expiresAt <= Date.now()) return undefined;
  const claims = decodeClaims(session.idToken);
  if (typeof claims.sub !== 'string') return undefined;
  return {
    subject: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    tenantId: typeof claims.tenant_id === 'string' ? claims.tenant_id : undefined,
    tenantRole: typeof claims.tenant_role === 'string' ? claims.tenant_role : undefined,
  };
}

export function signOutOnboarding(): void {
  sessionStorage.removeItem(SESSION_KEY);
  clearOAuthAttempt();
  if (!onboardingAuthEnabled) return;
  const query = new URLSearchParams({ client_id: cognitoClientId, logout_uri: logoutUri });
  window.location.assign(`${cognitoDomain}/logout?${query.toString()}`);
}
