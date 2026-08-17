# AWS IoT gateway simulator

This development-only simulator completes the real `ConnectedEnterpriseOnboarding-dev`
device path. It uses the repository's existing `aws-iot-device-sdk-v2` dependency and
Node's native cryptography; it does not require OpenSSL or add an npm dependency.

It deliberately follows the production contract:

1. Connect to AWS IoT with a temporary trusted-user provisioning claim and a random `bootstrap-*` client ID.
2. Generate an RSA-2048 operational private key locally and submit only a PKCS#10 CSR through `CreateCertificateFromCsr`.
3. Persist the issued certificate beside the operational key in protected staging before attempting registration;
4. Call `RegisterThing` with `SerialNumber`, `HardwareId`, and the one-time `HardwareProof`, then finalize the credential pair only after registration is accepted and reconnect with the exact assigned Thing name;
5. request the authoritative generation, verify the KMS signatures on both the assignment and profile manifest, verify bindings/expiry and the profile SHA-256, and download the short-lived S3 artifacts;
6. emulate a transactional apply in local state and publish `APPLYING`, `HEALTH_CHECK`, and the checksum-bound `APPLIED_HEALTHY` acknowledgement.

This is an integration simulator, not gateway firmware. Its "apply" writes a verified
active profile and journal locally; it does not modify Windows networking, resolve
Secrets Manager references, or claim to emulate a TPM.

## Safety requirements

- Never place a temporary trusted-user provisioning claim private key in this repository.
- The simulator never creates temporary trusted-user provisioning claim credentials. For the identity-transition demo,
  the companion trusted-user script calls `CreateProvisioningClaim` just in time and
  supplies AWS IoT's five-minute temporary trusted-user provisioning claim. Do not
  substitute a reusable fleet-scoped provisioning credential for this demo.
- The hardware proof is accepted only through a protected file, the `CE_SIM_HARDWARE_PROOF` process environment variable, or a hidden terminal prompt. It is never logged or persisted by the simulator.
- The certificate ownership token, certificate PEM, operational private key, and proof are never printed.
- `--signing-key-id` pins the exact KMS key ARN, while `--signing-public-key` supplies the corresponding public key. PEM and raw SPKI DER from `aws kms get-public-key` are supported.
- Generated state defaults to `.state/`, which is ignored by the simulator-local `.gitignore`. For the demo, use the external per-device state directory shown below.

## Identity-transition demo mode

Use `--stop-after-identity` when the demonstration should focus on the credential
handoff instead of profile application. This flag is intentionally fail-closed: the
per-device state directory must not already contain `identity.json`, so an existing
permanent identity cannot be mistaken for a new temporary trusted-user
claim-to-operational-certificate transition.

The fresh state directory must contain the temporary trusted-user provisioning claim
files `claim-certificate.pem` and `claim-private-key.pem`, plus
`profile-signing-public-key.der` and the protected hardware-proof file. The trusted-user
runner writes the two claim files only after
the UI operation reaches `ENROLLMENT_PENDING`, starts the simulator immediately,
and removes those temporary files after the handoff succeeds. Its simulator command
is equivalent to:

```powershell
npm run sim:gateway -- `
  --endpoint <iot-data-endpoint> `
  --template <fleet-template-name> `
  --serial <fresh-canonical-serial> `
  --hardware-id <fresh-hardware-id> `
  --generation 1 `
  --state-dir "<fresh-per-device-state-directory>" `
  --signing-key-id "<profile-signing-kms-key-arn>" `
  --expected-thing-name <expected-thing-name> `
  --hardware-proof-file "<protected-proof-file>" `
  --stop-after-identity
```

The phase log proves, in order:

1. five-minute temporary trusted-user provisioning claim mTLS connection with a random `bootstrap-*` client ID;
2. local key/CSR generation and CSR submission (the private key stays local);
3. operational certificate issuance, protected local staging, and `RegisterThing` acceptance;
4. temporary trusted-user provisioning-session disconnect and durable permanent credential storage;
5. permanent-certificate mTLS reconnect and signed assignment verification.

The permanent config request lets the AWS control plane finalize the certificate
handoff and record the assignment as delivered. The simulator then stops without
downloading profile artifacts, applying the profile, or publishing device statuses.
The UI can therefore show `PROFILE_STAGED`; that means the descriptor was delivered,
not that the profile was applied. Run the same command again **without**
`--stop-after-identity` (the temporary claim and proof are no longer read) to continue through
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
  --hardware-id tpm-ekhash-ce-test-gw-0001 `
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

The temporary trusted-user provisioning claim and hardware proof used for the first
enrollment were deliberately retired after provisioning. They are not needed for the demo command:
the simulator resumes with the permanent operational identity, reverifies the signed
assignment and artifacts, then idempotently re-acknowledges generation 1 as healthy.

For a separate first-time trusted-user enrollment, enter its hardware proof at the hidden prompt.
To use an ACL-restricted file instead, add:

```powershell
--hardware-proof-file "C:\path\to\hardware-proof.txt"
```

The file must contain the exact proof bytes with no leading/trailing whitespace
and no final newline. This intentionally matches the hardware-proof contract;
PowerShell's default `Set-Content` newline is rejected.

Do not put the proof directly in a command-line argument. If automation requires an
environment variable, scope it to the process and remove it immediately afterward:

```powershell
$env:CE_SIM_HARDWARE_PROOF = '<read from an approved secret source>'
try {
  npm run sim:gateway -- <the options above>
} finally {
  Remove-Item Env:CE_SIM_HARDWARE_PROOF -ErrorAction SilentlyContinue
}
```

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
`device-certificate.pem`, and `device-private-key.pem` and no longer need the temporary
trusted-user provisioning claim or hardware proof. A matching already-applied generation
is checksum-checked and idempotently re-acknowledged. A stale generation or a same-generation profile
conflict is rejected locally.

An interrupted first-time Fleet Provisioning attempt may leave a uniquely named
`.provisioning-*` directory. Before registration, it contains the locally generated
operational private key and, after `CreateCertificateFromCsr` succeeds, its issued
operational certificate. The certificate is written there before `RegisterThing`; the
directory never contains the ownership token or hardware proof. Finalization moves the
two credential files sequentially, so an interruption during that local move can leave
one in staging and one at its final path. A missing `identity.json` remains fail-closed.
Do not blindly delete or reset cloud records: inspect IoT certificate and onboarding ledger
state using the provisioning quarantine runbook before retrying a production-like case.
If failure occurred after the pre-provisioning hook accepted the request, the ledger is
bound to that issued certificate and a fresh CSR/certificate retry must fail closed.

## Options

Run `npm run sim:gateway -- --help` for defaults. Value options have matching
`CE_SIM_*` environment variables. Useful optional settings include `--root-ca`,
`--step-delay-ms` (default 2500), and `--timeout-ms` (default 90000). The
`--stop-after-identity` flag is CLI-only and takes no value.
