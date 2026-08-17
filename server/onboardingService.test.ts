import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OnboardingError, OnboardingService } from './onboardingService.js';
import { MemoryOnboardingRepository } from './onboardingStore.js';
import type { OperatorContext } from './onboardingTypes.js';

const tenantA: OperatorContext = { tenantId: 'tenant_demo', actorId: 'operator_a' };
const tenantB: OperatorContext = { tenantId: 'tenant_other', actorId: 'operator_b' };

async function setup(options: { simulateDevice?: boolean } = {}) {
  let current = new Date('2026-08-16T12:00:00.000Z');
  const service = await OnboardingService.create({
    repository: new MemoryOnboardingRepository(),
    now: () => new Date(current),
    transitionMs: 1_000,
    simulateDevice: options.simulateDevice ?? false,
  });
  return {
    service,
    advance(milliseconds: number) {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}

async function verifiedGateway(service: OnboardingService, key = 'verify-key-0001') {
  return service.verifyClaim(tenantA, {
    serialNumber: 'CE-GW-840021',
  }, key);
}

describe('OnboardingService', () => {
  it('reserves an authorized factory serial, starts a monotonic deployment, and reaches applied healthy', async () => {
    const { service, advance } = await setup({ simulateDevice: true });
    const verification = await verifiedGateway(service);
    const snapshot = await service.getSnapshot(tenantA);
    const profile = snapshot.profiles.find((candidate) => candidate.modelId === verification.identity.modelId);
    assert.ok(profile);

    const operation = await service.startOnboarding(tenantA, {
      verificationId: verification.verificationId,
      siteId: verification.allowedSites[0].id,
      profileVersionId: profile.id,
    }, 'onboard-key-0001');
    assert.equal(operation.deploymentGeneration, 1);
    assert.equal(operation.state, 'CLAIM_ACCEPTED');
    await assert.rejects(
      verifiedGateway(service, 'verify-after-consumed'),
      (error: unknown) => error instanceof OnboardingError && error.code === 'CLAIM_NOT_VERIFIED',
    );

    advance(10_000);
    await service.reconcileAll();
    const completed = await service.getOperation(tenantA, operation.id);
    assert.equal(completed.status, 'SUCCEEDED');
    assert.equal(completed.state, 'APPLIED_HEALTHY');
    assert.deepEqual(completed.timeline.map((entry) => entry.state), [
      'CLAIM_ACCEPTED',
      'CSR_VERIFIED',
      'OPERATIONAL_IDENTITY_ISSUED',
      'PROFILE_STAGED',
      'APPLYING',
      'HEALTH_CHECK',
      'APPLIED_HEALTHY',
    ]);
    const finalSnapshot = await service.getSnapshot(tenantA);
    assert.equal(finalSnapshot.gateways[0].state, 'ACTIVE');
    assert.equal(finalSnapshot.gateways[0].health, 'HEALTHY');
    assert.equal(finalSnapshot.gateways[0].certificateState, 'ACTIVE');
  });

  it('replays identical idempotent requests and rejects key reuse with a different payload', async () => {
    const { service } = await setup();
    const first = await verifiedGateway(service, 'verify-replay-01');
    const replay = await verifiedGateway(service, 'verify-replay-01');
    assert.deepEqual(replay, first);

    await assert.rejects(
      service.verifyClaim(tenantA, {
        serialNumber: 'CE-GW-840022',
      }, 'verify-replay-01'),
      (error: unknown) => error instanceof OnboardingError && error.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  it('enforces the factory serial grammar', async () => {
    const { service } = await setup();
    for (const [index, serialNumber] of [
      'A',
      'CE GW 840021',
      `CE-${'G'.repeat(126)}`,
    ].entries()) {
      await assert.rejects(
        service.verifyClaim(tenantA, { serialNumber }, `invalid-serial-${index}`),
        (error: unknown) => error instanceof OnboardingError && error.code === 'INVALID_CLAIM_INPUT',
      );
    }
  });

  it('does not expose another tenant\'s verification, operation, or manufacturing identity', async () => {
    const { service } = await setup();
    const verification = await verifiedGateway(service);
    const snapshot = await service.getSnapshot(tenantA);
    const profile = snapshot.profiles.find((candidate) => candidate.modelId === verification.identity.modelId);
    assert.ok(profile);
    const operation = await service.startOnboarding(tenantA, {
      verificationId: verification.verificationId,
      siteId: verification.allowedSites[0].id,
      profileVersionId: profile.id,
    }, 'onboard-tenant-01');

    await assert.rejects(
      service.getOperation(tenantB, operation.id),
      (error: unknown) => error instanceof OnboardingError && error.code === 'OPERATION_NOT_FOUND',
    );
    await assert.rejects(
      service.verifyClaim(tenantB, {
        serialNumber: 'CE-GW-840021',
      }, 'verify-tenant-b1'),
      (error: unknown) => error instanceof OnboardingError && error.code === 'CLAIM_NOT_VERIFIED',
    );
    assert.equal((await service.getSnapshot(tenantB)).gateways.length, 0);
  });

  it('rejects raw secrets but accepts Secrets Manager references in immutable profiles', async () => {
    const { service } = await setup();
    await assert.rejects(
      service.createProfile(tenantA, {
        name: 'Unsafe Branch',
        modelId: 'edge-pro',
        parameters: { wifiPassword: 'plaintext' },
        changeNote: 'Should fail validation',
      }, 'profile-unsafe-01'),
      (error: unknown) => error instanceof OnboardingError && error.code === 'RAW_SECRET_FORBIDDEN',
    );

    const profile = await service.createProfile(tenantA, {
      name: 'Secret Referenced Branch',
      modelId: 'edge-pro',
      parameters: {
        wanMtu: 1500,
        vpnCredentialRef: 'secretsmanager://tenant_demo/gateways/tunnel',
        wireGuardKeyRef: 'arn:aws:secretsmanager:us-east-1:111122223333:secret:tenant_demo/wireguard',
      },
      changeNote: 'Reference secret without embedding it',
    }, 'profile-safe-001');
    assert.equal(profile.immutable, true);
    assert.equal(profile.version, 1);
    assert.match(profile.contentHash, /^[a-f0-9]{64}$/);

    const successor = await service.createProfile(tenantA, {
      name: 'Renamed Secret Referenced Branch',
      modelId: 'edge-pro',
      baseProfileVersionId: profile.id,
      parameters: { wanMtu: 1492 },
      changeNote: 'Keep lineage while renaming the version',
    }, 'profile-successor1');
    assert.equal(successor.profileId, profile.profileId);
    assert.equal(successor.version, 2);

    await assert.rejects(
      service.createProfile(tenantA, {
        name: 'Wrong Model Successor',
        modelId: 'edge-compact',
        baseProfileVersionId: profile.id,
        parameters: { wanMtu: 1492 },
        changeNote: 'Must not change lineage model',
      }, 'profile-wrong-model'),
      (error: unknown) => error instanceof OnboardingError && error.code === 'PROFILE_MODEL_MISMATCH',
    );

    await assert.rejects(
      service.createProfile(tenantA, {
        name: 'Invalid MTU',
        modelId: 'edge-pro',
        parameters: { wanMtu: 100_000 },
        changeNote: 'Exercise server schema validation',
      }, 'profile-invalid01'),
      (error: unknown) => error instanceof OnboardingError && error.code === 'INVALID_PROFILE_PARAMETER',
    );
  });

  it('rejects stale device generations and records an automatic rollback on apply failure', async () => {
    const { service } = await setup();
    const verification = await verifiedGateway(service);
    const snapshot = await service.getSnapshot(tenantA);
    const profile = snapshot.profiles.find((candidate) => candidate.modelId === verification.identity.modelId);
    assert.ok(profile);
    const operation = await service.startOnboarding(tenantA, {
      verificationId: verification.verificationId,
      siteId: verification.allowedSites[0].id,
      profileVersionId: profile.id,
    }, 'onboard-rollback1');
    const gateway = (await service.getSnapshot(tenantA)).gateways[0];

    await assert.rejects(
      service.recordDeviceStatus(tenantA, {
        thingName: gateway.thingName,
        deploymentGeneration: operation.deploymentGeneration + 1,
        status: 'APPLIED_HEALTHY',
      }),
      (error: unknown) => error instanceof OnboardingError && error.code === 'STALE_GENERATION',
    );

    const failed = await service.recordDeviceStatus(tenantA, {
      thingName: gateway.thingName,
      deploymentGeneration: operation.deploymentGeneration,
      status: 'APPLY_FAILED',
      reason: 'WAN validation could not reach its policy probes.',
    });
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.state, 'ROLLED_BACK');
    assert.equal(failed.failure?.rolledBack, true);
    assert.equal((await service.getSnapshot(tenantA)).gateways[0].state, 'QUARANTINED');
  });

  it('deploys a successor profile to an active gateway with a new generation', async () => {
    const { service, advance } = await setup({ simulateDevice: true });
    const verification = await verifiedGateway(service);
    const initial = (await service.getSnapshot(tenantA)).profiles.find((candidate) => candidate.modelId === verification.identity.modelId);
    assert.ok(initial);
    const onboard = await service.startOnboarding(tenantA, {
      verificationId: verification.verificationId,
      siteId: verification.allowedSites[0].id,
      profileVersionId: initial.id,
    }, 'onboard-deploy-01');
    advance(10_000);
    await service.reconcileAll();
    assert.equal((await service.getOperation(tenantA, onboard.id)).status, 'SUCCEEDED');

    const successor = await service.createProfile(tenantA, {
      name: initial.name,
      description: initial.description,
      modelId: initial.modelId,
      baseProfileVersionId: initial.id,
      parameters: { ...initial.parameters, wanMtu: 1492 },
      changeNote: 'Reduce WAN MTU for the managed underlay',
    }, 'profile-deploy-v2');
    const gateway = (await service.getSnapshot(tenantA)).gateways[0];
    const deployment = await service.assignProfile(tenantA, gateway.id, {
      profileVersionId: successor.id,
      deliveryMode: 'JOB',
    }, 'assign-deploy-01');
    assert.equal(deployment.type, 'PROFILE_DEPLOY');
    assert.equal(deployment.state, 'PROFILE_STAGED');
    assert.equal(deployment.deploymentGeneration, 2);

    advance(10_000);
    await service.reconcileAll();
    const completed = await service.getOperation(tenantA, deployment.id);
    assert.equal(completed.state, 'APPLIED_HEALTHY');
    assert.equal(completed.status, 'SUCCEEDED');
    assert.deepEqual(completed.timeline.map((entry) => entry.state), [
      'PROFILE_STAGED',
      'APPLYING',
      'HEALTH_CHECK',
      'APPLIED_HEALTHY',
    ]);
    const updatedGateway = (await service.getSnapshot(tenantA)).gateways[0];
    assert.equal(updatedGateway.profileVersionId, successor.id);
    assert.equal(updatedGateway.deploymentGeneration, 2);
  });

  it('decommissions by certificate deactivation without deleting audit history', async () => {
    const { service, advance } = await setup({ simulateDevice: true });
    const verification = await verifiedGateway(service);
    const snapshot = await service.getSnapshot(tenantA);
    const profile = snapshot.profiles.find((candidate) => candidate.modelId === verification.identity.modelId);
    assert.ok(profile);
    const onboard = await service.startOnboarding(tenantA, {
      verificationId: verification.verificationId,
      siteId: verification.allowedSites[0].id,
      profileVersionId: profile.id,
    }, 'onboard-decom-01');
    advance(10_000);
    await service.reconcileAll();
    assert.equal((await service.getOperation(tenantA, onboard.id)).status, 'SUCCEEDED');
    const gateway = (await service.getSnapshot(tenantA)).gateways[0];

    const decommission = await service.decommissionGateway(tenantA, gateway.id, {
      confirmation: gateway.serialNumber,
    }, 'decom-key-00001');
    assert.equal(decommission.deploymentGeneration, 2);
    advance(10_000);
    await service.reconcileAll();
    const finalSnapshot = await service.getSnapshot(tenantA);
    assert.equal(finalSnapshot.gateways[0].state, 'DECOMMISSIONED');
    assert.equal(finalSnapshot.gateways[0].certificateState, 'INACTIVE');
    assert.ok(finalSnapshot.auditTail.some((event) => event.action === 'GATEWAY_DECOMMISSION'));
  });
});
