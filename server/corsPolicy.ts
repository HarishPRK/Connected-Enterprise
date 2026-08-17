import type { CorsOptions, CorsOptionsDelegate, CorsRequest } from 'cors';

const developmentOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const baseOptions: Omit<CorsOptions, 'origin'> = {
  credentials: false,
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-CE-Device-Status-Token'],
  maxAge: 600,
};

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',', 1)[0]?.trim() || undefined;
}

function normalizeOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function requestOrigin(req: CorsRequest): string | undefined {
  const protocol = firstHeaderValue(req.headers['x-forwarded-proto']);
  const host = firstHeaderValue(req.headers['x-forwarded-host']) ?? firstHeaderValue(req.headers.host);
  if ((protocol !== 'http' && protocol !== 'https') || !host) return undefined;
  return normalizeOrigin(`${protocol}://${host}`);
}

export function createCorsOptionsDelegate(
  configuredOriginsRaw: string | undefined,
  nodeEnv: string | undefined,
): CorsOptionsDelegate {
  const configuredOrigins = new Set(
    String(configuredOriginsRaw ?? '')
      .split(',')
      .map((value) => normalizeOrigin(value.trim()))
      .filter((value): value is string => Boolean(value)),
  );

  return (req, callback) => {
    const suppliedOrigin = firstHeaderValue(req.headers.origin);
    const normalizedSuppliedOrigin = suppliedOrigin ? normalizeOrigin(suppliedOrigin) : undefined;
    const allowed = !suppliedOrigin
      || (normalizedSuppliedOrigin !== undefined && (
        configuredOrigins.has(normalizedSuppliedOrigin)
        || normalizedSuppliedOrigin === requestOrigin(req)
        || (nodeEnv !== 'production' && developmentOrigin.test(normalizedSuppliedOrigin))
      ));

    callback(null, {
      ...baseOptions,
      // A disallowed origin receives no CORS headers. Avoid raising an Express
      // error here: doing so can turn static assets into a blank-page 5xx while
      // the browser would already enforce the missing allow-origin header.
      origin: allowed && normalizedSuppliedOrigin ? normalizedSuppliedOrigin : false,
    });
  };
}
