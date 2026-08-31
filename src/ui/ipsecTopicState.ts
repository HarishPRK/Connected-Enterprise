/** Return the state published on one exact MQTT topic. */
export function ipsecStateForTopic<T extends { topic: string }>(
  states: readonly T[],
  topic: string,
): T | undefined {
  return states.find((state) => state.topic === topic);
}
