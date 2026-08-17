# AWS IoT gateway simulator

This development-only simulator completes the real `ConnectedEnterpriseOnboarding-dev`
device path. It uses the repository's existing `aws-iot-device-sdk-v2` dependency and
Node's native cryptography; it does not require OpenSSL or add an npm dependency.

It deliberately follows the production contract:

1. Connect to AWS IoT with the gateway's unique pre-flashed bootstrap certificate and a random `claim-*` client ID.
2. Generate an RSA-2048 operational private key locally and submit only a PKCS#10 CSR through `CreateCertificateFromCsr`.
3. Persist the issued certificate beside the operational key in protected staging before attempting registration;
4. Call `RegisterThing` with only the server-authorized `SerialNumber`, then finalize the credential pair only after registration is accepted and reconnect with the exact assigned Thing name;
5. request the authoritative generation, verify the KMS signatures on both the assignment and profile manifest, verify bindings/expiry and the profile SHA-256, and download the short-lived S3 artifacts;
6. emulate a transactional apply in local state and publish `APPLYING`, `HEALTH_CHECK`, and the checksum-bound `APPLIED_HEALTHY` acknowledgement.

This is an integration simulator, not gateway firmware. Its "apply" writes a verified
active profile and journal locally; it does not modify Windows networking, resolve
Secrets Manager references, or claim to emulate a TPM.

## Safety requirements

- Never place a bootstrap private key in this repository. Each simulated gateway must
  receive a unique pre-flashed bootstrap certificate/key pair through a protected
  manufacturing or lab provisioning channel; shared fleet credentials are rejected by
  the production contract.
- The simulator does not create or renew bootstrap credentials. It reads the persistent
  pair from the per-device state directory and removes both files only after the new
  permanent certificate has authenticated and the signed configuration assignment has
  been verified.
- The certificate ownership token, certificate PEM, and operational private key are never printed.
- `--signing-key-id` pins the exact KMS key ARN, while `--signing-public-key` supplies the corresponding public key. PEM and raw SPKI DER from `aws kms get-public-key` are supported.
- Generated state defaults to `.state/`, which is ignored by the simulator-local `.gitignore`. For the demo, use the external per-device state directory shown below.

## Identity-transition demo mode

Use `--stop-after-identity` when the demonstration should focus on the credential
handoff instead of profile application. This flag is intentionally fail-closed: the
per-device state directory must not already contain `identity.json`, so an existing
permanent identity cannot be mistaken for a new bootstrap-to-operational-certificate
transition.

The fresh state directory must contain the unique pre-flashed files
`bootstrap-certificate.pem` and `bootstrap-private-key.pem`, plus
`profile-signing-public-key.der`. Keep the bootstrap pair present while the UI operation
reaches `ENROLLMENT_PENDING`; the simulator retires it only after the permanent identity
has fetched and verified its signed configuration. The command is:

```powershell
npm run sim:gateway -- `
  --endpoint <iot-data-endpoint> `
  --template <fleet-template-name> `
  --serial <fresh-canonical-serial> `
  --generation 1 `
  --state-dir "<fresh-per-device-state-directory>" `
  --bootstrap-cert "<fresh-per-device-state-directory>\bootstrap-certificate.pem" `
  --bootstrap-key "<fresh-per-device-state-directory>\bootstrap-private-key.pem" `
  --signing-key-id "<profile-signing-kms-key-arn>" `
  --expected-thing-name <expected-thing-name> `
  --stop-after-identity
```

The phase log proves, in order:

1. unique pre-flashed bootstrap mTLS connection with a random `claim-*` client ID;
2. local key/CSR generation and CSR submission (the private key stays local);
3. operational certificate issuance, protected local staging, and `RegisterThing` acceptance;
4. bootstrap-session disconnect and durable permanent credential storage;
5. permanent-certificate mTLS reconnect, signed assignment verification, and bootstrap credential retirement.

The permanent config request lets the AWS control plane finalize the certificate
handoff and record the assignment as delivered. The simulator then stops without
downloading profile artifacts, applying the profile, or publishing device statuses.
The UI can therefore show `PROFILE_STAGED`; that means the descriptor was delivered,
not that the profile was applied. Run the same command again **without**
`--stop-after-identity` (the retired bootstrap pair is no longer needed) to continue through
`APPLIED_HEALTHY`.

## Existing identity demo command

From the repository root in PowerShell:

```powershell
npm run check:gateway-simulator
npm run test:gateway-simulator

npm run sim:gateway -- `
  --endpoint alht1i2bx8tzt-ats.iot.us-east-1.amazonaws.com `
  --template CEOnboarding-dev `
  --serial CE-TEST-GW-0001 `
  --generation 1 `
  --state-dir "C:\Users\haris\AppData\Local\ConnectedEnterprise\gateway-simulator\ce-test-gw-0001" `
  --signing-key-id "arn:aws:kms:us-east-1:841019700679:key/a594c391-4827-4c5d-a433-fdf1b327e641" `
  --expected-thing-name gw-d4c1f9b156b5004672053603
```

The current demo state directory already supplies the permanent, per-device paths:

- `identity.json`
- `device-certificate.pem`
- `device-private-key.pem`
- `profile-signing-public-key.der`
- `active-profile.json`, `active-manifest.json`, and `applied.json`

The unique pre-flashed bootstrap pair used for the first enrollment was deliberately
retired after the permanent configuration handoff. It is not needed for this command:
the simulator resumes with the permanent operational identity, reverifies the signed
assignment and artifacts, then idempotently re-acknowledges generation 1 as healthy.

For a separate first-time enrollment, provision a different certificate/key pair for
that serial. The authenticated UI reservation and server binding of the unique bootstrap
certificate are the authorization gates. No hardware ID or activation proof is sent by
the gateway in this development flow.

The successful terminal output reports `APPLIED_HEALTHY`, followed by a final
`complete` line. The browser polls the server-side operation, so a UI transition can
lag the MQTT acknowledgement by a few seconds.

For tomorrow's demo, start the UI with `npm run dev`, open
`http://localhost:5174/onboarding`, and show `CE-TEST-GW-0001` as **Applied healthy**.
Use **View operation** to reopen the completed generation-1 evidence. Running the
command above demonstrates an authenticated reconnect and fresh signature/checksum
verification without creating a new deployment.

## Resume behavior

After successful Fleet Provisioning, later runs load `identity.json`,
`device-certificate.pem`, and `device-private-key.pem` and no longer need the retired
bootstrap pair. A matching already-applied generation
is checksum-checked and idempotently re-acknowledged. A stale generation or a same-generation profile
conflict is rejected locally.

An interrupted first-time Fleet Provisioning attempt may leave a uniquely named
`.provisioning-*` directory. Before registration, it contains the locally generated
operational private key and, after `CreateCertificateFromCsr` succeeds, its issued
operational certificate. The certificate is written there before `RegisterThing`; the
directory never contains the ownership token. Finalization moves the
two credential files sequentially, so an interruption during that local move can leave
one in staging and one at its final path. A missing `identity.json` remains fail-closed.
Do not blindly delete or reset cloud records: inspect IoT certificate and onboarding ledger
state using the provisioning quarantine runbook before retrying a production-like case.
If failure occurred after the pre-provisioning hook accepted the request, the ledger is
bound to that issued certificate and a fresh CSR/certificate retry must fail closed.
If registration succeeded but the permanent configuration request was interrupted,
`identity.json` and the bootstrap files remain. Resume normally: the simulator uses the
permanent identity, verifies the signed assignment, and then retires the bootstrap pair.

## Options

Run `npm run sim:gateway -- --help` for defaults. Value options have matching
`CE_SIM_*` environment variables. Useful optional settings include `--root-ca`,
`--step-delay-ms` (default 2500), and `--timeout-ms` (default 90000). The
`--stop-after-identity` flag is CLI-only and takes no value.

Provisioning tooling may pass `--bootstrap-cert`/`CE_SIM_BOOTSTRAP_CERT` and
`--bootstrap-key`/`CE_SIM_BOOTSTRAP_KEY` explicitly. Both resolve to dedicated `.pem`
files directly inside `--state-dir`; paths outside that per-device boundary, paths that
overlap operational credentials, and a shared certificate/key path are rejected.
Bootstrap credentials must be single-link regular files. Symlinks, Windows junctions,
directories, and hard links are rejected before reading, permission changes, or retirement.
