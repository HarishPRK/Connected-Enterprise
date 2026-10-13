import type { ProfileVersion, Site } from './types';

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

/** Carry an operation's assignment into a new simulation, but recheck the
 * verified gateway model and authorized sites before choosing defaults. */
export function initialOnboardingAssignment(
  profiles: readonly ProfileVersion[],
  modelId: string,
  allowedSites: readonly Site[],
  preferred: { siteId?: string; profileVersionId?: string } = {},
): { siteId: string; profileVersionId: string } {
  const compatible = selectableProfiles(profiles.filter(profile => profile.modelId === modelId), preferred.profileVersionId);
  return {
    siteId: (allowedSites.find(site => site.id === preferred.siteId) ?? allowedSites[0])?.id ?? '',
    profileVersionId: (compatible.find(profile => profile.id === preferred.profileVersionId) ?? compatible[0])?.id ?? '',
  };
}
