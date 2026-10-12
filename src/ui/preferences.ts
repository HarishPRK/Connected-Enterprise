export interface Preferences {
  emailAlerts: boolean;
  smsAlerts: boolean;
  digest: boolean;
  aiAuto: boolean;
  tone: 'concise' | 'detailed';
  model: 'haiku' | 'sonnet' | 'opus';
  timeZone: 'America/Chicago' | 'America/New_York' | 'America/Los_Angeles' | 'UTC';
  theme: 'light' | 'dark' | 'auto';
  density: 'comfortable' | 'compact';
}

export const PREFERENCES_KEY = 'ce-preferences-v1';
export const PREFERENCES_EVENT = 'ce-preferences-changed';
export const DEFAULT_PREFERENCES: Preferences = {
  emailAlerts: true, smsAlerts: true, digest: false, aiAuto: true,
  tone: 'concise', model: 'haiku', timeZone: 'America/Chicago', theme: 'light', density: 'comfortable',
};

export function normalizePreferences(value: unknown): Preferences {
  const p = value && typeof value === 'object' ? value as Partial<Preferences> : {};
  return {
    emailAlerts: typeof p.emailAlerts === 'boolean' ? p.emailAlerts : DEFAULT_PREFERENCES.emailAlerts,
    smsAlerts: typeof p.smsAlerts === 'boolean' ? p.smsAlerts : DEFAULT_PREFERENCES.smsAlerts,
    digest: typeof p.digest === 'boolean' ? p.digest : DEFAULT_PREFERENCES.digest,
    aiAuto: typeof p.aiAuto === 'boolean' ? p.aiAuto : DEFAULT_PREFERENCES.aiAuto,
    tone: p.tone === 'detailed' ? 'detailed' : 'concise',
    model: p.model === 'sonnet' || p.model === 'opus' ? p.model : 'haiku',
    timeZone: ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'UTC'].includes(p.timeZone ?? '') ? p.timeZone! : DEFAULT_PREFERENCES.timeZone,
    theme: p.theme === 'dark' || p.theme === 'auto' ? p.theme : 'light',
    density: p.density === 'compact' ? 'compact' : 'comfortable',
  };
}

export function readPreferences(): Preferences {
  try {
    const prefs = normalizePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null'));
    const theme = localStorage.getItem('ce-theme');
    if (theme === 'dark' || theme === 'light') prefs.theme = theme;
    if (localStorage.getItem('ce-theme-mode') === 'auto') prefs.theme = 'auto';
    return prefs;
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

export function savePreferences(preferences: Preferences): void {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(preferences)));
  window.dispatchEvent(new Event(PREFERENCES_EVENT));
}

export function aiPreferences() {
  const { model, tone, timeZone } = readPreferences();
  return { model, tone, timeZone };
}

export function formatLocalTime(value: string | number | Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleString(undefined, { ...options, timeZone: readPreferences().timeZone });
}
