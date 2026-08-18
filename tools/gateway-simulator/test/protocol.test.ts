import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import test from 'node:test';
import { generateOperationalCsr } from '../src/csr.js';
import {
  appliedStateDisposition,
  canonicalJson,
  modeledServiceErrorMessage,
  sha256Hex,
  statusPayloads,
  validateAssignmentResponse,
  verifyDownloadedArtifacts,
} from '../src/protocol.js';

test('canonicalJson orders object properties recursively', () => {
  assert.equal(
    canonicalJson({ z: 1, a: { y: true, b: 'value' }, list: [{ d: 2, c: 1 }] }),
    '{"a":{"b":"value","y":true},"list":[{"c":1,"d":2}],"z":1}',
  );
});

test('native CSR generator creates a usable RSA key and PKCS#10 PEM', () => {
  const generated = generateOperationalCsr('ce-sim-test');
  assert.match(generated.csrPem, /^-----BEGIN CERTIFICATE REQUEST-----/);
  assert.match(generated.csrPem, /-----END CERTIFICATE REQUEST-----\n$/);
  const data = Buffer.from('proof-of-key-possession');
  const signature = sign('sha256', data, generated.privateKeyPem);
  assert.equal(verify('sha256', data, generated.publicKeyPem, signature), true);
  assert.equal(createPublicKey(generated.privateKeyPem).export({ type: 'spki', format: 'pem' }).toString(), generated.publicKeyPem);
});

test('assignment and downloaded artifacts require both valid KMS signatures and exact checksums', () => {
  const fixture = signedFixture();
  const assignment = validateAssignmentResponse(fixture.response, fixture.expectation, fixture.publicKeyPem);
  const verified = verifyDownloadedArtifacts(
    assignment,
    fixture.profileText,
    fixture.manifestText,
    fixture.publicKeyPem,
    fixture.signingKeyId,
  );
  assert.equal(verified.checksum, fixture.profileChecksum);
  assert.equal(verified.profile.modelId, 'ce-gateway-v1');
});

test('downloaded artifacts accept aligned signed profile schema v2', () => {
  const fixture = signedFixture({ profile: 2 });
  const assignment = validateAssignmentResponse(fixture.response, fixture.expectation, fixture.publicKeyPem);
  const verified = verifyDownloadedArtifacts(
    assignment,
    fixture.profileText,
    fixture.manifestText,
    fixture.publicKeyPem,
    fixture.signingKeyId,
  );
  assert.equal(assignment.descriptor.schemaVersion, 2);
  assert.equal(verified.manifest.schemaVersion, 2);
  assert.equal(verified.profile.schemaVersion, 2);
});

test('downloaded artifacts reject mismatched profile, manifest, and assignment schema versions', () => {
  const mismatches = [
    signedFixture({ profile: 2, manifest: 1, descriptor: 1 }),
    signedFixture({ profile: 2, manifest: 2, descriptor: 1 }),
    signedFixture({ profile: 2, manifest: 1, descriptor: 2 }),
  ];
  for (const fixture of mismatches) {
    const assignment = validateAssignmentResponse(fixture.response, fixture.expectation, fixture.publicKeyPem);
    assert.throws(
      () => verifyDownloadedArtifacts(
        assignment,
        fixture.profileText,
        fixture.manifestText,
        fixture.publicKeyPem,
        fixture.signingKeyId,
      ),
      /schema versions do not match/,
    );
  }
});

test('signed assignment descriptors reject unsupported profile schema versions', () => {
  const fixture = signedFixture({ descriptor: 3 });
  assert.throws(
    () => validateAssignmentResponse(fixture.response, fixture.expectation, fixture.publicKeyPem),
    /descriptor schemaVersion must be 1 or 2/,
  );
});

test('tampered artifact content is rejected', () => {
  const fixture = signedFixture();
  const assignment = validateAssignmentResponse(fixture.response, fixture.expectation, fixture.publicKeyPem);
  assert.throws(
    () => verifyDownloadedArtifacts(
      assignment,
      `${fixture.profileText} `,
      fixture.manifestText,
      fixture.publicKeyPem,
      fixture.signingKeyId,
    ),
    /checksum/,
  );
});

test('an assignment signed by an unpinned key is rejected', () => {
  const fixture = signedFixture();
  assert.throws(
    () => validateAssignmentResponse(
      fixture.response,
      { ...fixture.expectation, signingKeyId: 'arn:aws:kms:us-east-1:111122223333:key/different' },
      fixture.publicKeyPem,
    ),
    /unpinned/,
  );
});

test('status payloads implement the handler contract through healthy attestation', () => {
  const checksum = 'a'.repeat(64);
  const payloads = statusPayloads(1, 'pv_test', checksum);
  assert.deepEqual(payloads.map((payload) => payload.status), ['APPLYING', 'HEALTH_CHECK', 'APPLIED_HEALTHY']);
  assert.equal(payloads[2]?.profileVersionId, 'pv_test');
  assert.equal(payloads[2]?.profileChecksum, checksum);
  assert.equal(payloads[0]?.profileChecksum, undefined);
});

test('applied generation journal rejects stale and conflicting assignments', () => {
  const previous = {
    generation: 2,
    profileVersionId: 'pv_two',
    profileChecksum: 'b'.repeat(64),
    appliedAt: '2026-08-16T20:00:00.000Z',
  };
  assert.equal(appliedStateDisposition(undefined, previous), 'APPLY');
  assert.equal(appliedStateDisposition(previous, previous), 'REACK');
  assert.throws(() => appliedStateDisposition(previous, { ...previous, generation: 1 }), /stale/);
  assert.throws(() => appliedStateDisposition(previous, { ...previous, profileVersionId: 'pv_conflict' }), /different profile/);
});

test('modeled Fleet Provisioning errors expose only bounded redacted fields', () => {
  const message = modeledServiceErrorMessage({
    modeledError: {
      statusCode: 403,
      errorCode: 'AccessDeniedException',
      errorMessage: 'RegisterThing denied; ownershipToken=do-not-print\nretry denied',
      unexpected: 'ignored',
    },
  }, 'RegisterThing');
  assert.equal(
    message,
    'RegisterThing rejected by AWS IoT (status 403, code AccessDeniedException): RegisterThing denied; ownershipToken=[REDACTED] retry denied',
  );
});

function signedFixture(schemaVersions: { profile?: number; manifest?: number; descriptor?: number } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const signingKeyId = 'arn:aws:kms:us-east-1:111122223333:key/test-signing-key';
  const profileSchemaVersion = schemaVersions.profile ?? 1;
  const manifestSchemaVersion = schemaVersions.manifest ?? profileSchemaVersion;
  const descriptorSchemaVersion = schemaVersions.descriptor ?? profileSchemaVersion;
  const profile = { schemaVersion: profileSchemaVersion, modelId: 'ce-gateway-v1', parameters: { serviceOffering: 'ANIRA' } };
  const profileText = canonicalJson(profile);
  const profileChecksum = sha256Hex(profileText);
  const descriptorPayload = {
    kind: 'gateway-profile-assignment',
    tenantId: 'ce-test',
    gatewayId: 'gw_test',
    thingName: 'gw-test-thing',
    generation: 1,
    profileId: 'profile_test',
    profileVersionId: 'pv_test',
    profileVersion: 1,
    schemaVersion: descriptorSchemaVersion,
    profileSha256: profileChecksum,
    objectKey: 'tenants/ce-test/profiles/profile_test/versions/0000000001/profile.json',
    manifestKey: 'tenants/ce-test/profiles/profile_test/versions/0000000001/manifest.json',
    issuedAt: '2026-08-16T20:00:00.000Z',
    expiresAt: '2026-08-17T20:00:00.000Z',
    signingKeyId,
  };
  const descriptor = signedObject(descriptorPayload, privateKey);
  const manifestPayload = {
    kind: 'gateway-profile',
    schemaVersion: manifestSchemaVersion,
    tenantId: 'ce-test',
    profileId: 'profile_test',
    profileVersionId: 'pv_test',
    version: 1,
    modelId: 'ce-gateway-v1',
    sha256: profileChecksum,
    objectKey: descriptorPayload.objectKey,
    issuedAt: '2026-08-16T20:00:00.000Z',
    signingKeyId,
  };
  const manifestText = canonicalJson(signedObject(manifestPayload, privateKey));
  const response = {
    type: 'SIGNED_PROFILE_ASSIGNMENT',
    requestId: 'sim-request-test',
    gatewayId: 'gw_test',
    thingName: 'gw-test-thing',
    generation: 1,
    profileVersionId: 'pv_test',
    descriptor,
    artifacts: {
      profile: {
        url: 'https://example-bucket.s3.us-east-1.amazonaws.com/profile.json?signature=test',
        sha256: profileChecksum,
        expiresAt: '2026-08-17T20:00:00.000Z',
      },
      manifest: {
        url: 'https://example-bucket.s3.us-east-1.amazonaws.com/manifest.json?signature=test',
        expiresAt: '2026-08-17T20:00:00.000Z',
      },
    },
    issuedAt: '2026-08-16T20:00:00.000Z',
  };
  return {
    response,
    expectation: {
      thingName: 'gw-test-thing',
      generation: 1,
      requestId: 'sim-request-test',
      signingKeyId,
      now: new Date('2026-08-16T20:30:00.000Z'),
    },
    privateKey,
    publicKeyPem,
    signingKeyId,
    profileText,
    profileChecksum,
    manifestText,
  };
}

function signedObject(payload: Record<string, unknown>, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']) {
  return {
    ...payload,
    signature: sign('sha256', Buffer.from(canonicalJson(payload)), privateKey).toString('base64'),
    signingAlgorithm: 'ECDSA_SHA_256',
  };
}
