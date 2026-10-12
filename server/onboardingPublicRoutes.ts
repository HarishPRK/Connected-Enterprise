import express, { type NextFunction, type Request, type Response } from 'express';
import { createOnboardingAwsBridge, OnboardingAwsBridgeError } from './onboardingAwsBridge.js';

const PUBLIC_ACTOR = 'anonymous-ec2-onboarding-dev';
const MAX_ACCESS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

interface PublicOnboardingConfig {
  apiFunctionArn: string;
  region: string;
  fixedTenantId: string;
  fixedSubject: string;
  expiresAt: number;
  allowedOrigins: Set<string>;
}

export function publicOnboardingConfig(
  env: NodeJS.ProcessEnv,
  now = Date.now(),
): PublicOnboardingConfig | undefined {
  if (env.ONBOARDING_PUBLIC_AWS_ENABLED !== 'true') return undefined;
  const expiresAt = Date.parse(env.ONBOARDING_PUBLIC_AWS_EXPIRES_AT ?? '');
  if (!Number.isFinite(expiresAt) || expiresAt > now + MAX_ACCESS_DURATION_MS) {
    throw new Error('Temporary onboarding requires an explicit expiry within seven days.');
  }
  const allowedOrigins = new Set((env.ONBOARDING_PUBLIC_AWS_ORIGINS ?? '').split(',').filter(Boolean).map((value) => {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Temporary onboarding origins must be exact HTTP(S) origins.');
    }
    return url.origin;
  }));
  if (!allowedOrigins.size) throw new Error('Temporary onboarding requires explicit browser origins.');
  const region = env.ONBOARDING_PUBLIC_AWS_REGION ?? 'us-east-1';
  const apiFunctionArn = env.ONBOARDING_PUBLIC_AWS_FUNCTION_ARN ?? '';
  const fixedTenantId = env.ONBOARDING_PUBLIC_AWS_TENANT_ID ?? '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(fixedTenantId)
    || !/^arn:aws:lambda:[a-z0-9-]+:\d{12}:function:connected-enterprise-onboarding-dev-api$/.test(apiFunctionArn)
    || apiFunctionArn.split(':')[3] !== region) {
    throw new Error('Temporary onboarding requires a fixed tenant and the development API Lambda ARN.');
  }
  return { apiFunctionArn, region, fixedTenantId, fixedSubject: PUBLIC_ACTOR, expiresAt, allowedOrigins };
}

interface RouterOptions {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  bridgeFactory?: typeof createOnboardingAwsBridge;
}

// This explicit temporary mode delegates one tenant's live operations to a
// shared service actor. It is intentionally anonymous; it is not a simulator
// and must never inherit tenant, role, or Lambda metadata from the browser.
export function createPublicOnboardingRouter(options: RouterOptions = {}): express.Router {
  const router = express.Router();
  const now = options.now ?? Date.now;
  let config: PublicOnboardingConfig | undefined;
  let bridge: ReturnType<typeof createOnboardingAwsBridge> | undefined;
  let configurationFailed = false;
  try {
    config = publicOnboardingConfig(options.env ?? process.env, now());
    if (config) bridge = (options.bridgeFactory ?? createOnboardingAwsBridge)(config);
  } catch {
    configurationFailed = true;
    console.error('[onboarding] temporary AWS access configuration is invalid; access is disabled.');
  }
  const enabled = () => Boolean(config && bridge && config.expiresAt > now());
  const noStore = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  };

  router.get('/access-mode', noStore, (_req, res) => {
    if (configurationFailed) {
      res.status(503).json({ error: { code: 'ONBOARDING_CONFIGURATION_ERROR', message: 'Temporary onboarding access is not configured correctly.' } });
      return;
    }
    if (!enabled()) { res.json({ mode: 'cognito' }); return; }
    const principal = bridge!.resolvePrincipal();
    res.json({
      mode: 'temporary-public-aws',
      user: { subject: principal.subject, tenantId: principal.tenantId, tenantRole: principal.role },
      expiresAt: new Date(config!.expiresAt).toISOString(),
    });
  });

  let inFlight = 0;
  router.use('/live', noStore, async (req, res) => {
    if (!enabled()) {
      res.status(503).json({ error: { code: 'TEMPORARY_ACCESS_DISABLED', message: 'Temporary AWS onboarding access is disabled or has expired.' } });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      res.status(405).json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Unsupported onboarding method.' } });
      return;
    }
    // Origin checks prevent other websites from submitting a visitor's live
    // operation inadvertently. This is not an authentication boundary.
    const origin = req.header('origin');
    if ((origin && !config!.allowedOrigins.has(origin)) || (req.method === 'POST' && !origin)) {
      res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Open onboarding from the configured application origin.' } });
      return;
    }
    if (req.method === 'POST' && !req.is('application/json')) {
      res.status(415).json({ error: { code: 'JSON_REQUIRED', message: 'Onboarding requests must use JSON.' } });
      return;
    }
    if (inFlight >= 8) {
      res.setHeader('Retry-After', '2');
      res.status(429).json({ error: { code: 'BUSY', message: 'Onboarding is busy. Retry this request.' } });
      return;
    }
    inFlight += 1;
    try {
      const result = await bridge!.forward({ method: req.method, path: req.path, body: req.body, idempotencyKey: req.header('idempotency-key') });
      res.status(result.statusCode).set(result.headers).send(result.body);
    } catch (error) {
      const known = error instanceof OnboardingAwsBridgeError;
      res.status(known ? error.statusCode : 502).json({ error: {
        code: known ? error.code : 'ONBOARDING_UPSTREAM_ERROR',
        message: known ? error.message : 'The live AWS onboarding service is unavailable.',
      } });
    } finally {
      inFlight -= 1;
    }
  });
  return router;
}
