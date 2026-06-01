# File inventory — what to copy into the other repo

All paths are **relative to the source repo root** (`Connected Enterprise/`)
and the **target repo root** (whatever your new project is). Where the source
and target paths are identical, just copy the file as-is.

Files marked **(adjust imports)** may import sibling files using paths like
`../components/Card` — if you flatten or rearrange the target project, fix
those imports accordingly.

---

## Shared (required by BOTH features)

| Source | Destination | Notes |
|---|---|---|
| `design-tokens.css`                  | `src/design-tokens.css`                  | Import once in your `main.tsx`. Provides every `var(--accent)` / `var(--panel)` / `var(--ok)` token both pages use. |
| `src/components/Card.tsx`            | `src/components/Card.tsx`                | (adjust imports) Uses only React + the CSS classes. |
| `src/components/PageHeader.tsx`      | `src/components/PageHeader.tsx`          | |
| `src/ui/Theme.tsx`                   | `src/ui/Theme.tsx`                       | Exposes `useThemeColors()` hook. |
| `src/ui/Toast.tsx`                   | `src/ui/Toast.tsx`                       | Mount `<ToastProvider>` above your `<App />`. |
| `src/ui/markdown.tsx`                | `src/ui/markdown.tsx`                    | Tiny dependency-free renderer for Bedrock output. |

---

## Dynamic Path Selection

### Frontend

| Source | Destination | Notes |
|---|---|---|
| `src/pages/DynamicPathSelection.tsx` | `src/pages/DynamicPathSelection.tsx`     | (adjust imports) The main page. ~1800 lines. |
| `src/ui/useIpsecMetrics.ts`          | `src/ui/useIpsecMetrics.ts`              | Live hook hitting `/api/ipsec/snapshot` + `/api/ipsec/stream`. |
| `src/ui/agentClient.ts`              | `src/ui/agentClient.ts`                  | Only the `runIpsecInsightSSE` helper is needed; strip the rest if you want. |
| `src/components/widgets/Sparkline.tsx` | `src/components/widgets/Sparkline.tsx` | Used in the diagram badges. |
| `src/types.ts`                       | `src/types.ts`                           | Copy at least the **IpsecGatewayMetric / IpsecTunnelMetric / IpsecWanMetric / IpsecMetrics / IpsecSnapshot / IpsecGatewayState** interfaces. |

### Backend

| Source | Destination | Notes |
|---|---|---|
| `server/ipsecProto.ts`               | `server/ipsecProto.ts`                   | Hand-rolled proto3 decoder. Zero deps. |
| `server/ipsecSource.ts`              | `server/ipsecSource.ts`                  | MQTT subscriber. Owns the snapshot cache. |
| `integration/server-snippets/ipsec-routes.ts` | `server/ipsec-routes.ts`        | Drop-in route registrar. Imports `ipsecSource`. |

### Optional (AI insight card)

| Source | Destination | Notes |
|---|---|---|
| `server/llm.ts`                      | `server/llm.ts`                          | Bedrock client factory. |
| `server/bedrockBearer.ts`            | `server/bedrockBearer.ts`                | Bearer-token Bedrock client (long-term ABSK key). |
| `src/components/widgets/AiInsightCard.tsx` | `src/components/widgets/AiInsightCard.tsx` | Reusable card; the DPS page wires it via `runIpsecInsightSSE`. |
| `integration/server-snippets/ipsec-insight-route.ts` | `server/ipsec-insight-route.ts` | Registers `/api/ipsec/insight`. Requires `llm.ts`. |

---

## Video Analytics

### Frontend

| Source | Destination | Notes |
|---|---|---|
| `src/pages/VideoAnalytics.tsx`       | `src/pages/VideoAnalytics.tsx`           | ~2100 lines. Contains the illustration components (SceneFire, SceneWeapon, etc.) and BBox overlay. |

### Backend

| Source | Destination | Notes |
|---|---|---|
| `integration/server-snippets/video-routes.ts` | `server/video-routes.ts`        | Drop-in route registrar with the stream-ID → upstream-URL map. |

---

## Server entry — minimum viable

If the target project has no Express server yet, drop this file at
`server/index.ts`:

```ts
import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });

import express from 'express';
import cors from 'cors';
import { registerIpsecRoutes }        from './ipsec-routes.js';
import { registerIpsecInsightRoute }  from './ipsec-insight-route.js';  // remove if no AI insight
import { registerVideoRoutes }        from './video-routes.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

registerIpsecRoutes(app);
registerIpsecInsightRoute(app);
registerVideoRoutes(app);

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => console.log(`server listening on :${PORT}`));
```

Add a `server/tsconfig.json` mirroring this project's (NodeNext module
resolution, `target: ES2022`, `outDir: dist-server`).

Run it with:

```bash
npx tsx watch server/index.ts
```

---

## Quick sanity-check checklist

After copying, before running:

- [ ] `npm install` resolves cleanly (see `package-deps.json`)
- [ ] `import './design-tokens.css'` is in `main.tsx`
- [ ] `<ToastProvider>` wraps `<App />`
- [ ] `.env` has `AWS_IOT_ENDPOINT`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
      `AWS_SECRET_ACCESS_KEY`, `AWS_IOT_TOPIC=rdk/ipsec/metrics`
- [ ] `vite.config.ts` proxies `/api` → `localhost:3001`
- [ ] `npx tsc --noEmit -p tsconfig.app.json` passes
- [ ] `npx tsc --noEmit -p server/tsconfig.json` passes
