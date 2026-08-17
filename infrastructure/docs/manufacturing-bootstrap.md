# Manufacturing and bootstrap runbook

## Non-negotiable claim-key rule

This stack creates an **unattached policy only** (`BootstrapClaimPolicyName`). It never creates a claim certificate, generates a claim key, stores a claim private key, or exports one. If Fleet Provisioning by claim is approved as a fallback, security/manufacturing must create a separate claim per limited batch in a controlled system, attach only the output policy, record only the certificate ID in the ledger, monitor use, and revoke/rotate it at the end of the batch. Never put a fleet-wide claim private key in this repository, S3, DynamoDB, Secrets Manager, logs, stack outputs, or an operator workstation.

Preferred production enrollment uses a unique hardware-backed manufacturer identity or trusted-user provisioning. The operational key must be generated in a TPM/secure element, and the gateway must call `CreateCertificateFromCsr`; the bootstrap policy intentionally cannot call `CreateKeysAndCertificate`.

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

## 2. Import manufacturing inventory

Input is a non-empty JSON array with `serialNumber`, a high-entropy
`activationCode` (16–256 characters in the exact shared credential grammar),
`hardwareId`, `modelId`, `hardwareRevision`, `manufacturingBatch`, and
`allowedSiteIds`. Whitespace, unsupported characters, weak periodic values, and
codes repeated within a batch are rejected. The code is used only to derive a
versioned `HMAC_SHA256_PEPPER_V1` digest and is never stored. Restrict and
securely delete the input file according to manufacturing policy.

Validate first, then apply:

```powershell
npx tsx scripts/import-manufacturing.ts `
  --file .\batch.json `
  --table <ControlPlaneTableName> `
  --secret-arn <HardwareProofSecretArn> `
  --tenant-id <tenant-id> `
  --claim-certificate-id <batch-claim-certificate-id>

# Only after reviewing the dry run:
npx tsx scripts/import-manufacturing.ts <same arguments> --apply
```

Writes are conditional and refuse to replace an existing serial. Grant this operator role only `secretsmanager:GetSecretValue`, `kms:Decrypt`, and conditional `dynamodb:PutItem` for the named resources; application roles do not need manufacturing-import authority.

## 3. Runtime enrollment state machine

1. The authenticated UI submits serial + activation code. The API verifies the HMAC and atomically changes `CLAIMABLE → RESERVED` for 15 minutes. An unexpired reservation cannot be overwritten; idempotency replay is the only repeat path.
2. The UI selects an allowed site and model-compatible immutable profile. The API consumes the verification and changes `RESERVED → ENROLLMENT_PENDING`.
3. The gateway connects as `bootstrap-*`, generates its operational key in hardware, submits a CSR, and calls `RegisterThing` with serial, hardware ID, and hardware proof. It does **not** receive or submit the UI verification ID.
4. The hook validates the exact template, batch claim certificate ID, proof, hardware ID, unexpired server-side reservation, tenant/gateway binding, and new certificate ID. The conditional transaction changes `ENROLLMENT_PENDING → PROVISIONING`; a retry succeeds only for the same certificate/Thing.
5. The template activates the certificate, associates it exclusively with the Thing, and attaches the existing operational policy. The gateway discards access to the claim credential and reconnects with client ID exactly equal to Thing name.
6. On the first permanent-certificate connection, the device subscribes to `ce/v1/gateways/<thing>/config/response` and immediately publishes its authoritative generation to `ce/v1/gateways/<thing>/config/request`; that broker-bound request atomically changes the ledger `PROVISIONING → PROVISIONED`, marks the certificate active, and only then returns the signed descriptor. The hook never emits delivery work before Fleet Provisioning creates the Thing and attachments. Later assignments are announced through named Shadow `configuration` or a deterministic Job behind a current-generation dispatch lease. The device downloads the short-lived exact S3 object, checks the signature and signed `signingKeyId` against its pinned/rotatable key set, rejects generations at or below its persisted applied generation, applies transactionally, and rolls back on failed health checks.
7. Success requires an mTLS/broker-bound `APPLIED_HEALTHY` status on `ce/v1/gateways/<thing>/status` containing the authoritative generation, `profileVersionId`, and lowercase SHA-256 `profileChecksum`. Only then does the operation become successful.
8. A `ROLLED_BACK` status must contain that failed candidate generation plus the exact **previously applied** `profileVersionId` and `profileChecksum`. The handler validates both against the last healthy attestation, records the restored profile as authoritative, and clears the failed desired descriptor through the fenced outbox. Missing/mismatched rollback evidence—or rollback during initial onboarding with no healthy baseline—moves the gateway to quarantine for operator recovery.

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
