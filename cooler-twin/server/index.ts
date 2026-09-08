import 'dotenv/config';
import { readConfig } from './config.js';
import { createTelemetryService } from './service.js';

const options = readConfig();
const service = createTelemetryService(options);
const port = await service.start();
console.info(`[telemetry] ${options.source} listening at http://${options.host}:${port}; WebSocket /ws`);
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await service.stop(); } catch { process.exitCode = 1; }
  });
}
