import test from 'node:test';
import assert from 'node:assert/strict';
import { runAskSSE } from '../src/ui/agentClient.ts';
import { normalizePreferences } from '../src/ui/preferences.ts';

test('invalid persisted preferences cannot inject unsupported models, zones or modes', () => {
  const prefs = normalizePreferences({ model: 'unknown-model', timeZone: 'not-a-zone', theme: 'invalid', density: 'invalid', emailAlerts: 'yes', tone: 'detailed' });
  assert.equal(prefs.model, 'haiku');
  assert.equal(prefs.timeZone, 'America/Chicago');
  assert.equal(prefs.theme, 'light');
  assert.equal(prefs.density, 'comfortable');
  assert.equal(prefs.emailAlerts, true);
  assert.equal(prefs.tone, 'detailed');
});

test('AI stream parses fragmented CRLF events and sends selected model preferences', async () => {
  const originalFetch = globalThis.fetch;
  let posted: unknown;
  globalThis.fetch = async (_url, init) => {
    posted = JSON.parse(String(init?.body));
    const parts = ['event:chunk\r\ndata:{"text":"hello ', 'world"}\r\n\r\nevent: done\r\ndata: {"ok":true}\r\n\r\n'];
    return new Response(new ReadableStream({ start(controller) { parts.forEach((part) => controller.enqueue(new TextEncoder().encode(part))); controller.close(); } }));
  };
  try {
    const events: string[] = [];
    await new Promise<void>((resolve, reject) => runAskSSE({ branchId: 'b-mck-03', messages: [{ role: 'user', content: 'Check WAN' }], preferences: { model: 'sonnet', tone: 'detailed', timeZone: 'UTC' } }, { onEvent: (event) => events.push(`${event.event}:${event.data.text ?? ''}`), onError: reject, onDone: resolve }));
    assert.deepEqual(events, ['chunk:hello world', 'done:']);
    assert.equal((posted as { preferences: { model: string } }).preferences.model, 'sonnet');
  } finally { globalThis.fetch = originalFetch; }
});

test('AI HTTP error completes the request and preserves the server error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'This model is not configured' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  try {
    const errors: string[] = [];
    await new Promise<void>((resolve) => runAskSSE({ branchId: 'b-mck-03', messages: [] }, { onEvent: () => assert.fail('No events expected'), onError: (message) => errors.push(message), onDone: resolve }));
    assert.deepEqual(errors, ['This model is not configured']);
  } finally { globalThis.fetch = originalFetch; }
});

test('stopping an AI request suppresses late events and completion from an old response', async () => {
  const originalFetch = globalThis.fetch;
  let respond!: (response: Response) => void;
  globalThis.fetch = () => new Promise((resolve) => { respond = resolve; });
  try {
    const callbacks: string[] = [];
    const stop = runAskSSE({ branchId: 'b-mck-03', messages: [] }, { onEvent: () => callbacks.push('event'), onError: () => callbacks.push('error'), onDone: () => callbacks.push('done') });
    stop();
    respond(new Response('event: chunk\ndata: {"text":"stale answer"}\n\n'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(callbacks, []);
  } finally { globalThis.fetch = originalFetch; }
});
