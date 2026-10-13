# AWS IoT gateway simulator

## Run from the EC2 onboarding screen

When temporary public AWS onboarding and `ONBOARDING_AWS_SIMULATOR_ENABLED=true`
are enabled for `ce-test`:

1. In **Initiate Onboarding**, choose **Simulated gateway**.
2. Use the generated `MOCK-` gateway ID or enter a fresh one, for example
   `MOCK-MCK-001`. Choose its model, verify the gateway, and select its site and
   profile.
3. Review the assignment and click **INITIATE FLOW**. The application creates the
   activation operation; the server prepares or reuses its original one-time
   bootstrap identity and starts the software gateway. No ZIP upload or download
   is needed for this managed flow.
4. Watch the AWS activation timeline. The simulator provisions its permanent
   certificate, verifies the signed profile, simulates its local application, and
   publishes the authenticated health acknowledgement. A successful simulator
   exit alone does not confirm activation; the operation must report completion.

For a registered `MOCK-` gateway already awaiting activation, open its operation
and choose **INITIATE FLOW** in **Simulated gateway · live AWS**. If its one-time
package was issued before server retention was available, use a new `MOCK-` ID;
the server cannot recover the old private key or silently replace that identity.

Only `MOCK-` IDs, the fixed development endpoints, and the exact active operation's
tenant/model/site/profile/generation are accepted. The server retains the original
stored archive returned by the trusted AWS API, up to 64 KiB. Before starting a
process, it checks the assignment, archive structure and checksums, certificate
fingerprint and validity, and matching private key. The browser supplies no
credential archive, storage path, or replacement assignment.
Two concurrent processes and a three-minute process deadline bound each host's
work. Repeated starts of one operation return the existing job. A failed or
interrupted device with state on disk is never automatically re-provisioned.

Original bootstrap archives, including their private keys, are kept outside the
repository at
`~/.local/share/connected-enterprise/managed-bootstrap/<MOCK-ID>.zip`, with directory
mode 0700 and file mode 0600. This private store persists across server restarts,
holds at most 50 archives, and rejects identity replacement. Preserve the service
user's home storage across application releases; do not include it in Git or
deployment bundles.

The software gateway's protected state is kept outside the repository at
`~/.local/share/connected-enterprise/mock-gateways/<MOCK-ID>` with directory mode
0700 and private files/logs mode 0600. Successful devices retain their operational
identity and verified applied profile. The extracted bootstrap pair in this
per-device directory is retired after the permanent connection verifies the
signed assignment; the separate managed bootstrap archive remains retained.
This screen runs software gateways only. Physical gateways use their installed
bootstrap credentials and existing device activation flow.

`config/dev-profile-signing-public-key.der` contains the existing development
KMS **public** verification key for
`arn:aws:kms:us-east-1:841019700679:key/a594c391-4827-4c5d-a433-fdf1b327e641`.
Its SHA-256 is `8ebc2d35110303b60210ef784b331e67dc10d6148593cf6e0a25312a9ee32e2e`.
No signing private key or gateway credentials are checked in.

This development-only simulator completes the real `ConnectedEnterpriseOnboarding-dev`
device path. It uses the repository's existing `aws-iot-device-sdk-v2` dependency and
Node's native cryptography; it does not require OpenSSL or add an npm dependency.

For a manual CLI simulator, register an unused lab ID (for example
`CE-GW-MCK-001`) in Gateway Onboarding, or leave the ID blank to generate one.
Choose the model, site, and profile and start activation. With **Physical gateway**
selected in **Initiate Onboarding**, prepare and download the bootstrap package
using that same ID, model, site, and profile. Install the original package in the
simulator's external state directory and use its ID as `--serial`. No factory
inventory entry is needed beforehand. Physical devices use the same
registration/package flow, installing the package on their device. The managed
screen above instead requires a `MOCK-` ID and prepares its package internally.

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
- The CLI device process does not create or renew bootstrap credentials. It reads
  the pair from the per-device state directory and removes both files only after
  the new permanent certificate has authenticated and the signed configuration
  assignment has been verified. For managed flow, the server obtains or reuses
  the registered gateway's original bootstrap package before launching that process.
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
  --generation 5 `
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

Fresh registrations start at generation **5**, which is also the simulator default.
Later deployments advance to 6, 7, and so on. For an existing registration, use its
actual generation from the UI; changing the default does not renumber it. The
historical demo identity below still uses generation 1.

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
