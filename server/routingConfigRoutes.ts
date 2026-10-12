import express from 'express';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRoutingConfig, validateRoutingConfigUpdate, type RoutingConfig } from '../shared/routing-config.js';

export function createRoutingConfigRouter(options: { dataFile?: string } = {}): express.Router {
  const router = express.Router();
  const dataFile = options.dataFile ?? process.env.ROUTING_CONFIG_FILE
    ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '.data', 'routing-config.json');
  let database: Record<string, RoutingConfig> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const serialized = <T,>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  };
  const load = async () => {
    if (database) return database;
    try {
      const parsed = JSON.parse(await readFile(dataFile, 'utf8')) as Record<string, RoutingConfig>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || Object.entries(parsed).some(([branchId, config]) => !/^[A-Za-z0-9_-]{1,100}$/.test(branchId) || config.branchId !== branchId || validateRoutingConfigUpdate(config))) throw new Error('Stored routing configuration is invalid.');
      database = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      database = Object.create(null) as Record<string, RoutingConfig>;
    }
    return database;
  };

  router.use('/:branchId', (req, res, next) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(String(req.params.branchId))) {
      res.status(400).json({ error: 'The branch identifier is invalid.' });
      return;
    }
    next();
  });

  router.get('/:branchId', async (req, res) => {
    try {
      const branchId = String(req.params.branchId);
      const config = await serialized(async () => {
        const saved = await load();
        return Object.hasOwn(saved, branchId) ? saved[branchId] : defaultRoutingConfig(branchId);
      });
      res.set('Cache-Control', 'no-store').json(config);
    } catch {
      res.status(503).json({ error: 'Unable to load saved routing configuration.' });
    }
  });

  router.put('/:branchId', async (req, res) => {
    const validation = validateRoutingConfigUpdate(req.body);
    if (validation) { res.status(400).json({ error: validation }); return; }
    try {
      const branchId = String(req.params.branchId);
      const outcome = await serialized(async () => {
        const currentDb = await load();
        const current = Object.hasOwn(currentDb, branchId) ? currentDb[branchId] : defaultRoutingConfig(branchId);
        if (req.body.revision !== current.revision) return { conflict: true, current } as const;
        const next: RoutingConfig = {
          branchId, revision: current.revision + 1, updatedAt: new Date().toISOString(),
          policies: req.body.policies.map((p: RoutingConfig['policies'][number]) => ({ ...p, app: p.app.trim(), match: p.match.trim() })),
          thresholds: req.body.thresholds,
        };
        const nextDb = { ...currentDb, [branchId]: next };
        await mkdir(path.dirname(dataFile), { recursive: true });
        const temporaryFile = `${dataFile}.${process.pid}.tmp`;
        await writeFile(temporaryFile, `${JSON.stringify(nextDb, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
        await rename(temporaryFile, dataFile);
        database = nextDb;
        return { conflict: false, current: next } as const;
      });
      if (outcome.conflict) {
        res.status(409).json({ error: 'Routing configuration changed in another session. Refresh and try again.', current: outcome.current });
      } else res.json(outcome.current);
    } catch {
      res.status(503).json({ error: 'Unable to save routing configuration. Your changes were not applied.' });
    }
  });
  return router;
}
