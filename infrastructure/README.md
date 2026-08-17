# Connected Enterprise onboarding infrastructure

This isolated AWS CDK application defines `ConnectedEnterpriseOnboarding-dev` in `us-east-1`. It creates new namespaced resources and does not import, update, or attach anything to the legacy DeviceManagement API, tables, certificates, policies, or provisioning templates.

## What it builds

- Cognito User Pool, Managed Login v2 domain, AWS-provided app-client branding, and public SPA client using authorization code + PKCE (no client secret or implicit flow). A V2 pre-token trigger resolves the operator's active DynamoDB membership and adds `tenant_id` and `tenant_role` to ID and access tokens.
- JWT-authorized HTTP API implementing the UI's `/api/onboarding/*` contract. Tenant identity comes only from verified JWT claims.
- A CMK-encrypted DynamoDB single table with PITR, deletion protection, TTL, two GSIs, Streams, transactional idempotency/generation controls, audit records, and an outbox.
- A private, versioned, CMK-encrypted S3 bucket for immutable profile/manifest artifacts and an asymmetric KMS P-256 signing key. KMS creates no exportable private key.
- Manufacturing-ledger verification and a pre-provisioning hook that binds a one-time hardware proof, authorized batch claim certificate, hardware ID, and server-side ownership reservation.
- CSR-only Fleet Provisioning with `EXCLUSIVE_THING`, an existing named operational policy, constrained service roles, and no `CreateKeysAndCertificate` permission.
- Broker-identity-enriched IoT Rules, named Shadow/Jobs delivery, monotonic generation fencing, apply/checksum acknowledgements, transactional manufacturing revocation, separate async-handler failure destinations, retry/DLQ handling, logs, and alarms.

## Local validation

```powershell
cd infrastructure
npm ci
npm run build
npm test
npm run synth
```

No deployment is performed by those commands. After an AWS/security review, deployment is an explicit operator action:

```powershell
npm run deploy
```

The stack is termination-protected and retained data resources also have deletion protection/retention policies.

## Frontend and Cognito configuration

Defaults support both the local UI and the canonical HTTPS application:

- callbacks: `http://localhost:5174/onboarding`, `https://connectedenterprise.app/onboarding`
- logouts: `http://localhost:5174/onboarding`, `https://connectedenterprise.app/onboarding`
- allowed origins: `http://localhost:5174`, `https://connectedenterprise.app`

For a hosted UI, pass JSON arrays through CDK context, for example:

```powershell
npx cdk deploy ConnectedEnterpriseOnboarding-dev `
  -c 'allowedOrigins=["https://console.example.com"]' `
  -c 'oauthCallbackUrls=["https://console.example.com/onboarding"]' `
  -c 'oauthLogoutUrls=["https://console.example.com/onboarding"]'
```

Use stack outputs as follows:

- `ApiUrl` → `VITE_ONBOARDING_API_URL` (bare origin; the UI appends `/api/onboarding/...`)
- `CognitoHostedUiBaseUrl` → `VITE_ONBOARDING_COGNITO_DOMAIN`
- `CognitoSpaClientId` → `VITE_ONBOARDING_COGNITO_CLIENT_ID`
- the configured callback/logout URLs → their corresponding frontend variables

Before a user can receive tenant claims, create the Cognito user, obtain its `sub`, then use the dry-run-first `scripts/bootstrap-tenant.ts` workflow to create `USER#<sub> / TENANT#<tenant>` membership plus sites/models. Pass `--default-membership` only to explicitly select the single default for a multi-tenant user; the guard CAS refuses concurrent defaults. Ambiguous or unsafe memberships fail token issuance closed.

## API contract

- `GET /api/onboarding/snapshot`
- `POST /api/onboarding/claims/verify`
- `POST /api/onboarding/profiles`
- `POST /api/onboarding/operations`
- `GET /api/onboarding/operations/{operationId}`
- `POST /api/onboarding/gateways/{gatewayId}/decommission`
- `POST /api/onboarding/gateways/{gatewayId}/assignments`

All mutations require `Idempotency-Key`. Assignment bodies contain `profileVersionId` and `deliveryMode` (`SHADOW` or `JOB`). Profile versions are immutable, strictly schema/range validated, contain only Secrets Manager references for secret-bearing fields, and are model-compatible on both onboarding and reassignment. `APPLIED_HEALTHY` is accepted only when the authenticated device reports the authoritative generation, profile version ID, and SHA-256 profile checksum. `ROLLED_BACK` must attest the exact previously applied profile version and checksum; a missing or invalid rollback target is quarantined.

## Required operator workflows

Read [manufacturing-bootstrap.md](docs/manufacturing-bootstrap.md) before importing inventory, enabling a batch claim certificate, quarantining a stuck identity, or replaying an async IoT failure queue. Export the signing **public** key with `aws kms get-public-key --key-id <ProfileSigningKeyArn>` and provision/pin its signed `signingKeyId` through the gateway's trusted manufacturing channel. The asymmetric private key never leaves KMS.

Production promotion still requires separate accounts/stacks, centralized CloudTrail and immutable audit retention, Device Defender/audit policies, alert destinations, recovery/transfer/quarantine runbooks, hardware-backed device keys, cross-tenant negative tests, and an explicit decision on whether shared batch claims are acceptable. Prefer unique hardware manufacturer identities or trusted-user provisioning over shared claims.
