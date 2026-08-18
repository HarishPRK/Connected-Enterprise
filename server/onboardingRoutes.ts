import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileOnboardingRepository, type OnboardingRepository } from './onboardingStore.js';
import { OnboardingError, OnboardingService } from './onboardingService.js';
import type { OperatorContext } from './onboardingTypes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type OnboardingRequest = Request & { onboardingContext?: OperatorContext };

interface RouterOptions {
  repository?: OnboardingRepository;
  dataFile?: string;
  transitionMs?: number;
  simulateDevice?: boolean;
  allowDevelopmentOperator?: boolean;
}

function developmentOperatorMiddleware(forceEnabled: boolean) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const explicitlyEnabled = forceEnabled || process.env.ONBOARDING_AUTH_MODE === 'development';
    if (process.env.NODE_ENV === 'production' || !explicitlyEnabled) {
      next(new OnboardingError(
        503,
        'ONBOARDING_AUTH_REQUIRED',
        'Direct Express onboarding is disabled. Use the Cognito-authorized AWS API or explicitly enable the local simulator.',
      ));
      return;
    }
    if (!isDirectLoopbackRequest(req)) {
      next(new OnboardingError(
        403,
        'LOCAL_SIMULATOR_ONLY',
        'The unauthenticated onboarding simulator accepts direct loopback requests only.',
      ));
      return;
    }
    (req as OnboardingRequest).onboardingContext = {
      tenantId: process.env.ONBOARDING_DEV_TENANT_ID ?? 'tenant_demo',
      actorId: process.env.ONBOARDING_DEV_ACTOR_ID ?? 'operator_demo',
      actorEmail: process.env.ONBOARDING_DEV_ACTOR_EMAIL,
    };
    next();
  };
}

function isDirectLoopbackRequest(req: Request): boolean {
  const forwardedHeaders = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'];
  if (forwardedHeaders.some((name) => req.header(name))) return false;
  const host = String(req.header('host') ?? '').trim().toLowerCase();
  const hostname = host.startsWith('[')
    ? host.slice(1, host.indexOf(']'))
    : host.split(':', 1)[0];
  return isLoopback(req.socket.remoteAddress)
    && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1');
}

function isLoopback(address: string | undefined): boolean {
  const normalized = String(address ?? '').toLowerCase();
  return normalized === '::1'
    || normalized === '127.0.0.1'
    || normalized.startsWith('::ffff:127.');
}

function context(req: Request): OperatorContext {
  const onboardingContext = (req as OnboardingRequest).onboardingContext;
  if (!onboardingContext) {
    throw new OnboardingError(500, 'MISSING_AUTH_CONTEXT', 'Onboarding authorization context is unavailable.');
  }
  return onboardingContext;
}

function idempotencyKey(req: Request): string {
  return String(req.header('Idempotency-Key') ?? '');
}

function sendSse(res: Response, event: string, value: unknown): void {
  if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

export async function createOnboardingRouter(options: RouterOptions = {}): Promise<express.Router> {
  const configuredStepMs = Number(process.env.ONBOARDING_SIMULATION_STEP_MS ?? 900);
  const repository = options.repository ?? new FileOnboardingRepository(
    options.dataFile ?? path.join(__dirname, '.data', 'onboarding.json'),
  );
  const service = await OnboardingService.create({
    repository,
    transitionMs: options.transitionMs ?? (Number.isFinite(configuredStepMs) ? configuredStepMs : 900),
    simulateDevice: options.simulateDevice
      ?? (process.env.ONBOARDING_SIMULATE_DEVICE ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
    mode: 'local-simulator',
  });
  const router = express.Router();
  const timer = setInterval(() => {
    void service.reconcileAll().catch((error) => {
      console.error('[onboarding] failed to reconcile operations', error);
    });
  }, 500);
  timer.unref();

  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  router.use(developmentOperatorMiddleware(options.allowDevelopmentOperator === true));

  router.get('/health', (_req, res) => {
    res.json({ ok: true, mode: 'local-simulator', authMode: 'server-fixed-development-context' });
  });

  router.get('/snapshot', async (req, res) => {
    res.json(await service.getSnapshot(context(req)));
  });

  router.post('/claims/verify', async (req, res) => {
    const result = await service.verifyClaim(context(req), {
      serialNumber: req.body?.serialNumber,
    }, idempotencyKey(req));
    res.status(201).json(result);
  });

  router.post('/profiles', async (req, res) => {
    const result = await service.createProfile(context(req), {
      name: req.body?.name,
      description: req.body?.description,
      modelId: req.body?.modelId,
      baseProfileVersionId: req.body?.baseProfileVersionId,
      schemaVersion: req.body?.schemaVersion,
      parameters: req.body?.parameters,
      changeNote: req.body?.changeNote,
    }, idempotencyKey(req));
    res.status(201).json(result);
  });

  router.post('/operations', async (req, res) => {
    const result = await service.startOnboarding(context(req), {
      verificationId: req.body?.verificationId,
      siteId: req.body?.siteId,
      profileVersionId: req.body?.profileVersionId,
    }, idempotencyKey(req));
    res.status(202).json(result);
  });

  router.get('/operations/:operationId', async (req, res) => {
    res.json(await service.getOperation(context(req), req.params.operationId));
  });

  router.post('/gateways/:gatewayId/assignments', async (req, res) => {
    const operation = await service.assignProfile(context(req), req.params.gatewayId, {
      profileVersionId: req.body?.profileVersionId,
      deliveryMode: req.body?.deliveryMode,
    }, idempotencyKey(req));
    res.status(202).json({ operation });
  });

  router.post('/gateways/:gatewayId/decommission', async (req, res) => {
    const result = await service.decommissionGateway(context(req), req.params.gatewayId, {
      confirmation: req.body?.confirmation,
    }, idempotencyKey(req));
    res.status(202).json(result);
  });

  // Local gateway simulator hook. The production path is an authenticated IoT
  // Rule/Lambda that derives Thing/principal from broker metadata, never payload.
  router.post('/device-status', async (req, res) => {
    const configuredToken = process.env.ONBOARDING_DEVICE_STATUS_TOKEN;
    const presentedToken = req.header('X-CE-Device-Status-Token');
    if (!configuredToken) {
      throw new OnboardingError(503, 'DEVICE_STATUS_DISABLED', 'The local device-status hook is disabled.');
    }
    if (presentedToken !== configuredToken) {
      throw new OnboardingError(401, 'DEVICE_AUTH_FAILED', 'Device status authentication failed.');
    }
    const result = await service.recordDeviceStatus({
      ...context(req),
      actorId: `device:${String(req.body?.thingName ?? 'unknown')}`,
    }, {
      thingName: req.body?.thingName,
      deploymentGeneration: Number(req.body?.deploymentGeneration),
      status: req.body?.status,
      reason: req.body?.reason,
    });
    res.status(202).json(result);
  });

  router.get('/events', async (req, res) => {
    const operator = context(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    req.socket.setNoDelay(true);

    sendSse(res, 'snapshot', await service.getSnapshot(operator));
    const unsubscribe = service.subscribe(async (event) => {
      if (event.tenantId !== operator.tenantId || res.writableEnded) return;
      try {
        const snapshot = await service.getSnapshot(operator);
        sendSse(res, 'snapshot', snapshot);
        const operation = snapshot.operations.find((candidate) => candidate.id === event.aggregateId);
        if (operation) sendSse(res, 'operation', operation);
      } catch {
        sendSse(res, 'error', { code: 'STREAM_REFRESH_FAILED', message: 'Refresh the onboarding view.' });
      }
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 15_000);
    heartbeat.unref();
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded) res.end();
    });
  });

  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next;
    if (error instanceof OnboardingError) {
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
      return;
    }
    console.error('[onboarding] unhandled error', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'The onboarding service could not complete the request.' } });
  });

  return router;
}
