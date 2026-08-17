# Unique bootstrap certificate runbook

## Non-negotiable bootstrap-key rule

Every gateway receives its own AWS IoT bootstrap certificate and private key before installation. The factory process writes the private key directly to that gateway's protected storage; the key is never placed in this repository, DynamoDB, S3, stack outputs, logs, or command output. Never reuse one bootstrap credential across gateways.

The CDK deployment creates the least-privilege bootstrap policy but does not create certificates or private keys. Before a certificate is bound to inventory, the operator tool proves that its public certificate matches the exact AWS IoT certificate ID, the certificate is `ACTIVE`, only the expected bootstrap policy is attached, and it is not attached to any Thing.

## 1. Bootstrap tenant metadata and membership

Create the Cognito user administratively and get its immutable `sub`. Prepare a JSON file containing tenant metadata, the subject/role, sites, and gateway models. Validate without writes, then apply explicitly:

```powershell
npx tsx scripts/bootstrap-tenant.ts --table <ControlPlaneTableName> --file .\tenant.json
npx tsx scripts/bootstrap-tenant.ts --table <ControlPlaneTableName> --file .\tenant.json --apply
```

The sole active membership does not need a default flag. For a user with
multiple active memberships, explicitly select one with
`--default-membership`; a conditional `DEFAULT_MEMBERSHIP_GUARD` prevents two
concurrent bootstrap transactions from creating defaults. Token issuance fails
closed unless there is one sole active membership or exactly one active
default. The browser cannot select or submit `tenant_id`/`tenant_role`.

## 2. Bind a unique pre-flashed certificate to inventory

The controlled factory system must create one certificate/key pair per gateway, attach only the stack output `BootstrapClaimPolicyName`, flash the pair into that gateway, and retain the public certificate plus AWS certificate ID in its manufacturing record. No hardware ID, activation code, hardware proof, manufacturing batch, or hardware revision is required by this flow.

Use the binding tool only with the public certificate file. Validate first, then apply:

```powershell
npm run bootstrap:bind-certificate -- `
  --region us-east-1 `
  --table <ControlPlaneTableName> `
  --tenant-id <tenant-id> `
  --serial <canonical-serial> `
  --model-id <model-id> `
  --site-id <site-id> `
  --profile-version-id <profile-version-id> `
  --delivery-mode SHADOW `
  --bootstrap-certificate-id <64-hex-certificate-id> `
  --bootstrap-certificate-file C:\factory-public\<serial>.pem `
  --bootstrap-policy <BootstrapClaimPolicyName>

# Only after reviewing the dry run:
npm run bootstrap:bind-certificate -- <same arguments> --apply
```

The script validates the tenant, model, site, profile, AWS certificate, and policy before writing. One DynamoDB transaction creates both the serial inventory record and a certificate-binding sentinel, so neither the serial nor certificate can be rebound. It reads no private key and never copies certificate material.

The restricted binding role needs only `iot:DescribeCertificate`, `iot:ListAttachedPolicies`, `iot:ListPrincipalThings`, the documented DynamoDB reads/scan, and the conditional DynamoDB transaction on this stack's table. It does not need certificate creation or private-key access.

## 3. Runtime enrollment state machine

1. The authenticated UI submits the serial. The JWT-authorized API verifies that the inventory record belongs to the user's tenant, that its unique bootstrap certificate is active, and atomically changes `CLAIMABLE → RESERVED`. An unexpired reservation cannot be overwritten; idempotency replay is the only repeat path.
2. The UI selects an allowed site and model-compatible immutable profile. Clicking **Start secure activation** consumes the verification and changes `RESERVED → ENROLLMENT_PENDING`.
3. Only after the UI displays **Secure activation progress** does the installer power on or start the gateway onboarding process.
4. The gateway connects with its pre-flashed certificate and a `claim-*` client ID, requests an operational certificate, and calls `RegisterThing` with only `SerialNumber`. The `claim-` text is the current MQTT client-prefix contract; it does not represent a separately issued credential. The hook validates the exact template ARN, exact pre-bound bootstrap certificate ID, `ACTIVE` bootstrap status, unexpired `ENROLLMENT_PENDING` reservation, tenant/gateway/operation/site/profile state, and new certificate ID. The conditional transaction changes `ENROLLMENT_PENDING → PROVISIONING`; a retry succeeds only for the same certificate and Thing.
5. The template activates the operational certificate, associates it exclusively with the Thing, and attaches the operational policy. The gateway persists the operational identity, disconnects the bootstrap session, and reconnects with client ID exactly equal to the returned Thing name.
6. On the first permanent-certificate connection, the device subscribes to `ce/v1/gateways/<thing>/config/response` and publishes generation 1 to `ce/v1/gateways/<thing>/config/request`. That broker-bound request atomically changes the ledger `PROVISIONING → PROVISIONED`, marks the operational certificate active, and schedules deactivation of the bootstrap certificate. The bootstrap credential must never be used again after deactivation.
7. The gateway receives the signed descriptor, verifies its KMS signature and binding, downloads the exact immutable S3 object, applies transactionally, and rolls back on failed health checks. Later assignments are announced through named Shadow `configuration` or a deterministic IoT Job.
8. Success requires an mTLS/broker-bound `APPLIED_HEALTHY` status on `ce/v1/gateways/<thing>/status` containing the authoritative generation, `profileVersionId`, and lowercase SHA-256 `profileChecksum`. Only then does the operation become successful.
9. A `ROLLED_BACK` status must contain the failed candidate generation plus the exact **previously applied** `profileVersionId` and `profileChecksum`. Missing or mismatched rollback evidence moves the gateway to quarantine.

For a simulator-only certificate exchange, put its unique bootstrap files in a protected directory outside the repository and run after the UI reaches `ENROLLMENT_PENDING`:

```powershell
npm run demo:run-preloaded-bootstrap -- `
  --region us-east-1 `
  --table <ControlPlaneTableName> `
  --endpoint <account-prefix>-ats.iot.us-east-1.amazonaws.com `
  --template CEOnboarding-dev `
  --serial <canonical-serial> `
  --bootstrap-certificate-id <64-hex-certificate-id> `
  --bootstrap-policy <BootstrapClaimPolicyName> `
  --state-dir C:\protected-onboarding\<canonical-serial> `
  --bootstrap-cert C:\protected-onboarding\<canonical-serial>\bootstrap-certificate.pem `
  --bootstrap-key C:\protected-onboarding\<canonical-serial>\bootstrap-private-key.pem `
  --signing-public-key C:\protected-onboarding\<canonical-serial>\profile-signing-public-key.der `
  --signing-key-id <ProfileSigningKeyArn>
```

The simulator directory and bootstrap private key must be accessible only to the current operator (plus Windows `SYSTEM`/Administrators where applicable). The runner validates those permissions, the UI/DynamoDB state, certificate-policy binding, and local certificate/key match without logging or copying the key. A physical gateway uses the same AWS protocol directly and does not use this runner.

IoT Rule inputs derive certificate ID, client ID, and topic from `principal()`, `clientid()`, and `topic()`; payload identity fields are never authorization inputs. Failed outbox dispatches remain `PENDING`, record sanitized attempts, retry through the stream mapping, and reach the encrypted DLQ after bounded retries.

## 4. Quarantine stuck provisioning

Never reset `PROVISIONING` directly to claimable. First confirm the gateway is
offline, then dry-run with the exact serial, certificate, operator identity,
reason, and account Data-ATS endpoint:

```powershell
npx tsx scripts/quarantine-stuck-provisioning.ts `
  --table <ControlPlaneTableName> --serial <serial> `
  --certificate-id <certificate-id> --actor <operator-sub> `
  --iot-data-endpoint <prefix>-ats.iot.us-east-1.amazonaws.com `
  --reason "ticket/change reference"
```

Re-run with `--apply` only after review. The script CAS-locks both records,
deactivates the certificate (or records `NOT_FOUND`), force-cleans the exact
MQTT session, transitions both records to `QUARANTINED`, and appends a tenant
audit record. It never makes the serial claimable.

## 5. Async IoT handler failure replay

The IoT Rule error queue covers rule/action failures. Handler failures after an
accepted asynchronous invocation go to separate encrypted config/status Lambda
destination queues whose URLs are stack outputs, with alarms on any message.
Before replay, retain the destination envelope, verify its original
`requestPayload` broker aliases against the current Thing/certificate, and
confirm its generation remains authoritative. Archive stale generations as
superseded. A restricted operator may invoke only the corresponding Lambda with
that original `requestPayload`; delete the queue message only after the durable
state transition is visible and the change ticket records the replay.
