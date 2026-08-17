import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import cors from 'cors';
import express from 'express';
import { createCorsOptionsDelegate } from './corsPolicy.js';

describe('hosted CORS policy', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    const app = express();
    app.use(cors(createCorsOptionsDelegate(undefined, 'production')));
    app.get('/asset.js', (_req, res) => res.type('text/javascript').send('export {}'));
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('allows the externally forwarded same origin without extra configuration', async () => {
    const response = await fetch(`${baseUrl}/asset.js`, {
      headers: {
        Origin: 'https://connectedenterprise.app',
        Host: 'connectedenterprise.app',
        'X-Forwarded-Host': 'connectedenterprise.app',
        'X-Forwarded-Proto': 'https',
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), 'https://connectedenterprise.app');
  });

  it('does not emit CORS permission for a different browser origin', async () => {
    const response = await fetch(`${baseUrl}/asset.js`, {
      headers: {
        Origin: 'https://untrusted.example',
        Host: 'connectedenterprise.app',
        'X-Forwarded-Host': 'connectedenterprise.app',
        'X-Forwarded-Proto': 'https',
      },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });
});
