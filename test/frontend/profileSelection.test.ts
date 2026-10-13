import assert from 'node:assert/strict';
import test from 'node:test';
import { currentProfiles, initialOnboardingAssignment, selectableProfiles } from '../../src/features/onboarding/profileSelection';
import type { ProfileVersion } from '../../src/features/onboarding/types';

function profile(id: string, overrides: Partial<ProfileVersion> = {}): ProfileVersion {
  return {
    id, profileId: 'baseline', name: 'Baseline', description: 'Gateway baseline',
    modelId: 'gateway-a', version: 1, schemaVersion: 2, parameters: {},
    contentHash: id, immutable: true, createdAt: '2026-08-17T00:00:00Z',
    createdBy: 'test', changeNote: 'Initial version', ...overrides,
  };
}

test('older versions and an identical copied profile collapse to the newest published configuration', () => {
  const old = profile('v1');
  const second = profile('v2', { version: 2 });
  const duplicate = profile('copy', { profileId: 'copy', contentHash: 'same',
    createdAt: '2026-08-18T23:24:15Z' });
  const latest = profile('v3', { version: 3, contentHash: 'same',
    createdAt: '2026-08-18T23:24:36Z' });
  const input = [second, duplicate, old, latest];
  assert.deepEqual(currentProfiles(input), [latest]);
  assert.deepEqual(input, [second, duplicate, old, latest]);
});

test('distinct current configurations, models and schemas stay selectable', () => {
  const profiles = [
    profile('a', { contentHash: 'same' }),
    profile('b', { profileId: 'retail', contentHash: 'different' }),
    profile('c', { profileId: 'other-model', modelId: 'gateway-b', contentHash: 'same' }),
    profile('d', { profileId: 'other-schema', schemaVersion: 1, contentHash: 'same' }),
  ];
  assert.equal(currentProfiles(profiles).length, 4);
});

test('version numbers are not compared across unrelated profile families', () => {
  const older = profile('v99', { version: 99 });
  const newer = profile('new', { profileId: 'new', version: 1, createdAt: '2026-09-01T00:00:00Z' });
  assert.equal(currentProfiles([older, newer])[0], newer);
});

test('a newer published version does not silently change a selection already made in an open form', () => {
  const selected = profile('v1');
  const next = profile('v2', { version: 2, createdAt: '2026-09-01T00:00:00Z' });
  assert.deepEqual(selectableProfiles([selected, next]), [next]);
  assert.deepEqual(selectableProfiles([selected, next], selected.id), [selected, next]);
});

test('missing hashes never cause unrelated configurations to be hidden', () => {
  assert.equal(currentProfiles([
    profile('a', { contentHash: '' }),
    profile('b', { profileId: 'other', contentHash: '' }),
  ]).length, 2);
  assert.deepEqual(currentProfiles([]), []);
});

test('a simulation preserves its source operation site and exact compatible profile version', () => {
  const original = profile('v1');
  const newest = profile('v2', { version: 2, createdAt: '2026-09-01T00:00:00Z' });
  const sites = [{ id: 'site-a', name: 'A', location: 'A' }, { id: 'site-b', name: 'B', location: 'B' }];
  assert.deepEqual(initialOnboardingAssignment([original, newest], 'gateway-a', sites, {
    siteId: 'site-b', profileVersionId: original.id,
  }), { siteId: 'site-b', profileVersionId: original.id });
});

test('simulation defaults cannot select a source site that is unauthorized or a profile for another model', () => {
  const current = profile('compatible');
  const other = profile('incompatible', { modelId: 'gateway-b', createdAt: '2026-10-01T00:00:00Z' });
  const sites = [{ id: 'allowed', name: 'Allowed', location: 'A' }];
  assert.deepEqual(initialOnboardingAssignment([current, other], 'gateway-a', sites, {
    siteId: 'forbidden', profileVersionId: other.id,
  }), { siteId: 'allowed', profileVersionId: current.id });
  assert.deepEqual(initialOnboardingAssignment([other], 'gateway-a', [], {
    siteId: 'forbidden', profileVersionId: other.id,
  }), { siteId: '', profileVersionId: '' });
});
