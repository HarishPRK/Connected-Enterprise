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
  criticalTitle: string;
  instruction: string;
}

const STREAM_SAFETY_COPY: Record<string, StreamSafetyCopy> = {
  'nv-nanoowl': {
    criticalTitle: 'Critical inventory exception detected',
    instruction: 'Check the Inventory Management feed for missing or unexpected items.',
  },
  'nv-violence': {
    criticalTitle: 'Possible violence detected',
    instruction: 'Check the Violence detection feed immediately and follow the site security procedure.',
  },
  'nv-fall': {
    criticalTitle: 'Possible fall detected',
    instruction: 'Check the Fall detection feed immediately and follow the site safety procedure.',
  },
  'nv-ppe': {
    criticalTitle: 'PPE compliance breach detected',
    instruction: 'Check the PPE compliance feed for a missing hard hat or safety vest.',
  },
  'nv-table': {
    criticalTitle: 'Critical table-monitor event detected',
    instruction: 'Check the Table monitor feed for an occupancy or dwell-time exception.',
  },
  'nv-weapon': {
    criticalTitle: 'Possible weapon detected',
    instruction: 'Check the Weapon detection feed immediately and follow the site security procedure.',
  },
  'nv-parking': {
    criticalTitle: 'Critical parking event detected',
    instruction: 'Check the Parking monitor feed for an unsafe or blocked bay.',
  },
  'ha-anpd': {
    criticalTitle: 'Critical number-plate event detected',
    instruction: 'Check the ANPR feed and verify the vehicle against the site access policy.',
  },
  'ha-intruder': {
    criticalTitle: 'Possible intrusion detected',
    instruction: 'Check the Intruder detection feed immediately and follow the site security procedure.',
  },
  'ha-hairnet': {
    criticalTitle: 'Hairnet compliance breach detected',
    instruction: 'Check the Hairnet monitor feed for a person without the required hair covering.',
  },
  'ha-fire': {
    criticalTitle: 'Possible smoke or flame detected',
    instruction: 'Check the Fire detection feed immediately and follow the site emergency procedure.',
  },
  'ha-crowd': {
    criticalTitle: 'Critical crowd threshold detected',
    instruction: 'Check the Crowd analytics feed for unsafe density or restricted flow.',
  },
  'ha-drive': {
    criticalTitle: 'Critical drive-thru event detected',
    instruction: 'Check the Drive-thru monitor feed for a blocked lane or excessive wait time.',
  },
};

const GENERIC_SAFETY_COPY: StreamSafetyCopy = {
  criticalTitle: 'Critical video analytics alert',
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

  if (event.channel === 4) {
    return {
      kind: 'critical',
      title: safety.criticalTitle,
      detail: `${source} was received while ${streamName} was active. ${safety.instruction}`,
      durationMs: 10_000,
      dedupeKey,
    };
  }

  if (event.channel === 3) {
    return {
      kind: 'success',
      title: `${streamName} reports all systems OK`,
      detail: `${source} confirms the green monitoring state. No operator action is required.`,
      durationMs: 4_800,
      dedupeKey,
    };
  }

  if (event.channel === 2) {
    return {
      kind: 'warn',
      title: `${streamName} warning`,
      detail: `${source} reported a warning. ${safety.instruction}`,
      durationMs: 7_500,
      dedupeKey,
    };
  }

  return {
    kind: 'warn',
    title: `${streamName} needs attention`,
    detail: `${source} reported an active alert. ${safety.instruction}`,
    durationMs: 7_500,
    dedupeKey,
  };
}
