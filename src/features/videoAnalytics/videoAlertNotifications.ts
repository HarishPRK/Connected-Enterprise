import type { VideoRelayEvent } from '../../ui/useVideoAlerts';

export function videoAlertEventKey(event?: VideoRelayEvent): string | undefined {
  return event ? `${event.topic}:${event.id}` : undefined;
}

export function canNotifyVideoAlert(event: VideoRelayEvent, paused: boolean, resumedAt: number): boolean {
  // Recoveries newer than Resume still matter. Historical events from the
  // paused interval must not become a burst of notifications on reconnect.
  return !paused && event.state === 'ON' && !event.retained
    && (!event.replayed || event.receivedAt >= resumedAt);
}
