import type { VideoRelayEvent } from '../../ui/useVideoAlerts';

export interface VideoAlertStreamContext {
  id: string;
  name: string;
}

export interface VideoAlertToastCopy {
  kind: 'success' | 'warn' | 'critical';
  title: string;
  detail: string;
  durationMs: number;
  dedupeKey: string;
}

interface StreamSafetyCopy {
  instruction: string;
}

const STREAM_SAFETY_COPY: Record<string, StreamSafetyCopy> = {
  'nv-nanoowl': {
    instruction: 'Check the Inventory Management feed for missing or unexpected items.',
  },
  'nv-violence': {
    instruction: 'Check the Violence detection feed immediately and follow the site security procedure.',
  },
  'nv-fall': {
    instruction: 'Check the Fall detection feed immediately and follow the site safety procedure.',
  },
  'nv-ppe': {
    instruction: 'Check the PPE compliance feed for a missing hard hat or safety vest.',
  },
  'nv-table': {
    instruction: 'Check the Table monitor feed for an occupancy or dwell-time exception.',
  },
  'nv-weapon': {
    instruction: 'Check the Weapon detection feed immediately and follow the site security procedure.',
  },
  'nv-parking': {
    instruction: 'Check the Parking monitor feed for an unsafe or blocked bay.',
  },
  'ha-anpd': {
    instruction: 'Check the ANPR feed and verify the vehicle against the site access policy.',
  },
  'ha-intruder': {
    instruction: 'Check the Intruder detection feed immediately and follow the site security procedure.',
  },
  'ha-hairnet': {
    instruction: 'Check the Hairnet monitor feed for a person without the required hair covering.',
  },
  'ha-fire': {
    instruction: 'Check the Fire detection feed immediately and follow the site emergency procedure.',
  },
  'ha-crowd': {
    instruction: 'Check the Crowd analytics feed for unsafe density or restricted flow.',
  },
  'ha-drive': {
    instruction: 'Check the Drive-thru monitor feed for a blocked lane or excessive wait time.',
  },
};

const GENERIC_SAFETY_COPY: StreamSafetyCopy = {
  instruction: 'Open the relevant live feed now and follow the site response procedure.',
};

/** Translate a real relay event into concise, stream-aware operator copy. */
export function buildVideoAlertToast(
  event: VideoRelayEvent,
  stream?: VideoAlertStreamContext,
): VideoAlertToastCopy {
  const safety = stream ? STREAM_SAFETY_COPY[stream.id] ?? GENERIC_SAFETY_COPY : GENERIC_SAFETY_COPY;
  const streamName = stream?.name ?? 'Video Analytics';
  const source = `${event.topic} ${event.code}`;
  const dedupeKey = `video-relay-${event.channel}-${stream?.id ?? 'unassigned'}`;
  const recovery = event.replayed ? ' Recovered after the live alert connection resumed.' : '';
  const context = stream
    ? `${source} was received.${recovery} Current verified feed: ${streamName}. The relay payload does not identify which detector originated the event. `
    : `${source} was received.${recovery} No verified live feed is currently open. The relay payload does not identify which detector originated the event. `;

  if (event.channel === 4) {
    return {
      kind: 'critical',
      title: event.replayed ? 'Recovered critical video analytics alert' : 'Critical video analytics alert',
      detail: `${context}${safety.instruction}`,
      durationMs: 10_000,
      dedupeKey,
    };
  }

  if (event.channel === 3) {
    return {
      kind: 'success',
      title: 'Video analytics reports all systems OK',
      detail: `${source} confirms the green monitoring state. No operator action is required.`,
      durationMs: 4_800,
      dedupeKey,
    };
  }

  if (event.channel === 2) {
    return {
      kind: 'warn',
      title: 'Video analytics warning',
      detail: `${context}${safety.instruction}`,
      durationMs: 7_500,
      dedupeKey,
    };
  }

  return {
    kind: 'warn',
    title: 'Video analytics needs attention',
    detail: `${context}${safety.instruction}`,
    durationMs: 7_500,
    dedupeKey,
  };
}
