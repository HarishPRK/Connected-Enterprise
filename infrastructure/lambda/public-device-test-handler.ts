import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

/**
 * Public dev-only connectivity probe for gateway HTTP integration testing.
 *
 * This function intentionally has no data-plane clients, environment secrets,
 * or tenant/configuration access. It must never become a configuration route.
 */
export const handler: APIGatewayProxyHandlerV2 = async (event) => ({
  statusCode: 200,
  headers: {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  },
  body: JSON.stringify({
    ok: true,
    service: 'connected-enterprise-gateway-http-test',
    stage: 'dev',
    requestId: event.requestContext.requestId,
  }),
});
