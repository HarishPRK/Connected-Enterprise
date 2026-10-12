/** Keep keyboard/action indexes in the same order as the grouped result list. */
export function orderCommandItems<T extends { group: string }>(items: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.group) ?? [];
    group.push(item);
    groups.set(item.group, group);
  }
  return [...groups.values()].flat();
}
