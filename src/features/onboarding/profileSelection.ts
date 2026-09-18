import type { ProfileVersion } from './types';

/** Publication time is comparable across profile families; version numbers
 * only have meaning inside one family. Never change the supplied snapshot. */
export function newestProfilesFirst(profiles: readonly ProfileVersion[]): ProfileVersion[] {
  const timestamp = (profile: ProfileVersion) => Date.parse(profile.createdAt) || 0;
  return [...profiles].sort((a, b) =>
    timestamp(b) - timestamp(a) || b.version - a.version || a.id.localeCompare(b.id));
}

/** One current version per family, with identical signed configurations
 * folded together. Historical IDs remain available for existing assignments. */
export function currentProfiles(profiles: readonly ProfileVersion[]): ProfileVersion[] {
  const families = new Map<string, ProfileVersion>();
  for (const profile of newestProfilesFirst(profiles)) {
    const key = `${profile.modelId}:${profile.profileId || profile.id}`;
    const previous = families.get(key);
    if (!previous || profile.version > previous.version) families.set(key, profile);
  }
  const fingerprints = new Set<string>();
  return newestProfilesFirst([...families.values()]).filter((profile) => {
    if (!profile.contentHash.trim()) return true;
    const key = `${profile.modelId}:${profile.schemaVersion}:${profile.contentHash.trim().toLowerCase()}`;
    if (fingerprints.has(key)) return false;
    fingerprints.add(key);
    return true;
  });
}

/** Keep an explicit choice stable if a newer version arrives while the form
 * is open. Only an untouched form automatically defaults to the latest. */
export function selectableProfiles(profiles: readonly ProfileVersion[], selectedId = ''): ProfileVersion[] {
  const current = currentProfiles(profiles);
  const selected = profiles.find((profile) => profile.id === selectedId);
  return selected && !current.some((profile) => profile.id === selectedId)
    ? [selected, ...current]
    : current;
}
