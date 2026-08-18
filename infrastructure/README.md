# Connected Enterprise onboarding infrastructure

This isolated AWS CDK application defines `ConnectedEnterpriseOnboarding-dev` in `us-east-1`. It creates new namespaced resources and does not import, update, or attach anything to the legacy DeviceManagement API, tables, certificates, policies, or provisioning templates.

## What it builds

- Cognito User Pool, Managed Login v2 domain, AWS-provided app-client branding, and public SPA client using authorization code + PKCE (no client secret or implicit flow). A V2 pre-token trigger resolves the operator's active DynamoDB membership and adds `tenant_id` and `tenant_role` to ID and access tokens.
- JWT-authorized HTTP API implementing the UI's `/api/onboarding/*` contract. Tenant identity comes only from verified JWT claims.
- A CMK-encrypted DynamoDB single table with PITR, deletion protection, TTL, two GSIs, Streams, transactional idempotency/generation controls, audit records, and an outbox.
- A private, versioned, CMK-encrypted S3 bucket for immutable profile/manifest artifacts and an asymmetric KMS P-256 signing key. KMS creates no exportable private key.
- Authenticated serial-inventory reservation and a pre-provisioning hook that binds one exact pre-flashed bootstrap certificate to the server-side tenant, gateway, operation, site, and profile reservation.
- Fleet Provisioning with `EXCLUSIVE_THING`, an existing named operational policy, constrained service roles, and support for both locally generated CSR identities and the gateway team's current certificate-creation test flow.
- Fleet-wide IoT Credentials Provider role alias plus Thing/certificate-scoped AWS_IAM API routes for signed configuration retrieval and apply/health acknowledgements. Legacy broker-identity IoT Rule adapters remain available during migration; named Shadow/Jobs notifications are optional.

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
- `GET /device/v1/things/{thingName}/certificates/{certificateId}/configuration?generation={N}` (`AWS_IAM`)
- `POST /device/v1/things/{thingName}/certificates/{certificateId}/status` (`AWS_IAM`)

Operator mutations require `Idempotency-Key`. The authenticated serial-reservation body contains only `serialNumber`; no activation code, hardware ID, or hardware proof is accepted or verified by the current runtime. Assignment bodies contain `profileVersionId` and `deliveryMode` (`PULL`, `SHADOW`, or `JOB`); `PULL` is the default and creates no MQTT Shadow or IoT Job notification. Replacing an exact unconfirmed assignment additionally requires `supersedeGeneration` to match the current generation, and atomically terminalizes the old deployment without marking it healthy. Profile versions are immutable, strictly schema/range validated, contain only Secrets Manager references for secret-bearing fields, and are model-compatible on both onboarding and reassignment. Device GET/POST calls use short-lived credentials issued from the permanent IoT certificate and are SigV4-authenticated; they do not use MQTT topics. The GET returns an allowlisted gateway identity, assignment metadata, the complete immutable profile document inline, and a compact KMS-signed integrity claim. The claim binds the canonical gateway-metadata hash, generation, profile version, and profile checksum. It never exposes DynamoDB records, tenant/certificate state, S3 keys, or presigned URLs. `APPLIED_HEALTHY` is accepted only when the authenticated device reports the authoritative generation, profile version ID, and SHA-256 profile checksum. `ROLLED_BACK` must attest the exact previously applied profile version and checksum; a missing or invalid rollback target is quarantined.

New UI profile creation requests explicitly use numeric `schemaVersion: 2`; omission preserves the legacy v1 create contract, and stored v1 versions remain readable. Schema v2 extends the existing flat profile with LAN MTU and DHCP server/pool/lease settings; DHCP or static WAN addressing and optional VLAN; WAN-provided or static DNS, search domain, and cache control; primary/secondary NTP servers; IPv4 forwarding, NAT mode, and default-route metric. Active combinations are validated together: static WAN requires its address and gateway, static DNS requires a primary server, WAN-provided DNS requires DHCP WAN, and an enabled DHCP pool must be ordered, remain inside the LAN subnet, and exclude gateway/network/broadcast addresses. Dormant WAN/DNS values can be omitted or empty, and disabled-DHCP pool values can be omitted.

The gateway needs a minimal local bootstrap WAN/default-route/DNS/time configuration before it can contact AWS. That prerequisite is factory/installer input, separate from the managed profile delivered after onboarding. Fleet Provisioning and IoT Thing attributes carry identity bindings only; they do not carry DHCP, WAN, DNS, NTP, LAN, forwarding, or NAT configuration. The device configuration API returns the whole assigned signed profile document for the generation.

S3 remains the private content-addressed source for profile bytes because it provides object immutability, versioning, KMS encryption, and avoids DynamoDB's 400 KB item limit. The configuration Lambda reads the exact object server-side, enforces a 1 MiB application limit, verifies its SHA-256 against the signed assignment, and then returns the parsed JSON inline. DynamoDB stores identity, lifecycle, indexes, assignment metadata, and audit state—not duplicate configuration blobs.

Assignments created before the inline-response contract do not contain the compact signed claim and fail closed. Migrate them by creating a new profile assignment/generation after deployment; no certificate rotation or onboarding reset is required.

## Required operator workflows

Read [manufacturing-bootstrap.md](docs/manufacturing-bootstrap.md) before binding a unique pre-flashed certificate to a serial, starting UI-led onboarding, quarantining a stuck identity, or replaying an async IoT failure queue. Export the signing **public** key with `aws kms get-public-key --key-id <ProfileSigningKeyArn>` and provision/pin its signed `signingKeyId` through the gateway's protected manufacturing channel. The asymmetric signing private key never leaves KMS.

Production promotion still requires separate accounts/stacks, centralized CloudTrail and immutable audit retention, Device Defender/audit policies, alert destinations, recovery/transfer/quarantine runbooks, hardware-backed device keys, cross-tenant negative tests, and factory controls proving that each bootstrap private key is installed on exactly one gateway. Hardware ID/proof is intentionally deferred; the current flow relies on UI authorization plus the exact unique certificate already bound to that serial.
