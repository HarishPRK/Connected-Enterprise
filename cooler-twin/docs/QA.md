# Verification record

Verified locally on 2026-09-07, with Node 26.5.0 and Blender 4.5.13 LTS.

- `npm run build`: TypeScript check and Vite production build pass.
- `npm test`: 13 tests pass, covering real HTTP/WS interaction, command validation/deduplication, origin rejection, static serving, thermal behavior, time integration, compressor hysteresis, inventory/reset, hardware-source isolation, and browser protocol freshness/ack validation.
- `python assets/validate_asset.py`: passes; 1,143,404-byte GLB, 98,349 triangles, 201 Draco primitives, seven AO-bearing materials, all 40 stock nodes and five shelf nodes.
- Browser loaded the production bundle from `http://127.0.0.1:3002`, including the locally bundled GLB, HDR, Draco decoder and fonts.
- Door opening was acknowledged by the service and visually animated. Temperature and humidity increased. Extended opening generated the duration and high-temperature alerts; reset cleared them.
- Applying 4.0°C updated the confirmed set point. The physical thermostat display uses the live middle-zone temperature.
- Replenishing one empty slot changed inventory from 34 to 35. Restock changed it to 40 and disabled further full-restock commands.
- One/five-minute history modes and diagnostics navigation were checked against live data.
- Component map visibly recolored the compressor, shelves and cabinet. Returning to realistic mode restored PBR colors.
- Mobile layout checked at 390×844, including expanded 3D view. HUD projection clamps labels inside the viewport. Desktop viewport restored after testing.
- JSON export and PNG capture handlers were exercised; PNG capture produced no application error. The in-app browser's automation did not emit a native download receipt, so filesystem download completion was not verified there.
- No application errors were logged by the final production build. Three.js emits an upstream `Clock` deprecation warning through the current R3F dependency; it does not prevent rendering. Earlier development-only fast-refresh hook-order logs were cleared by reloading after the hook implementation changed.

Not performed: physical hardware/broker commissioning, a deployed TLS/authenticated fleet service, cross-device GPU benchmarking, long-running soak tests, or calibration against a real cooler. See the server guide and research for commissioning requirements.
