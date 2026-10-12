# Application control audit — October 12, 2026

Local and EC2 began at `5877026` with the same uncommitted Influx endpoint update. That update was preserved in commit `82d8921`, synchronized to the EC2 checkout, and pushed to the existing GitHub branch before the control fixes.

The audit covers all 20 application routes and the shared shell. `npm run audit:controls` inventories 218 button declarations, 43 inputs, 23 selects, and 4 textareas. It reports no controls lacking an event handler, form action, or explicit unavailable/read-only state. This static inventory supports semantic review; it does not prove that every physical gateway operation was executed.

| Surface | Functional changes |
| --- | --- |
| Shell, Home, Fleet | Correct command-palette action order; device search; account information; notification read state; actual snapshot refresh; JSON/CSV export; selected-branch navigation; keyboard map controls. |
| IT/OT devices | Filtered CSV export, inventory refresh, discovery entry point, pending/error states for supported classification and Matter/Shelly controls; correct branch inventory scope; live empty inventories remain empty. |
| Routing / failover | Branch policies and SLA thresholds persist on the server, with validation, revision conflicts, and atomic writes. Templates, create/edit/delete, enable/disable, search, reset/save, and telemetry refresh work. Preview data cannot publish real gateway commands; failed publications restore the visual state. |
| Onboarding | Numeric fields support clearing and enforce bounds/steps; save/upload/issue guards; request idempotency follows actual form changes; snapshot validation. Existing authenticated AWS workflow retained. |
| Settings / AI | Controlled, saved browser preferences; system theme, density and timezone; server-configured model choices; response style honored by the server; new-incident assignment preference; cancellation and stale-stream guards. Live incident analysis uses live tools and cannot fall through to fabricated demo diagnostics. |
| Operations | Audit date filtering and CSV; Security CSV; Cost/Command Center PDF printing; saved incident filters; editable/downloadable runbooks; operator review flags; video fullscreen during the initiating click. |
| Dialogs | Keyboard focus stays inside the visible dialog, autofocus is preserved, focus returns to the trigger, and closed drawers are inert. |

Verification before deployment: production build passed; 129 server tests and 79 UI tests passed. Browser checks covered rendering all 20 routes, all seven store scenarios, camera controls and chapter seeking, command search, saved settings after reload, and routing template validation/save/reload/toggle/filter/edit/delete. Temporary local routing test data was removed through the UI. Existing React compiler lint findings and visual detector warnings remain in incumbent components; they were not treated as proof of broken controls.

## Integration boundaries

- Notification records remain the existing sample alert list. Marking them read is saved on this browser. Email/SMS/digest delivery services, Slack and PagerDuty are not configured.
- General device reboot, disable and door unlock have no supported backend integration. Their controls explain that limitation instead of reporting invented success. Manual commissioning remains a gateway/administrator task; Add device opens the discovery workflow.
- Saved policy/SLA configuration is used by the dashboard. The existing application-route command protocol does not implement full gateway policy/SLA enforcement; the UI states that distinction.
- Incident analysis and operator flags do not execute remediation. Live flags are session-local; sample decisions and runbooks use browser storage.
- Production onboarding still requires Cognito sign-in and the appropriate role. No production registration, retirement, gateway path change, relay switch, or other physical device operation was performed as a smoke test.
- The embedded Gateway Twin Studio runs on its separately managed origin. The dashboard's load/reload/open/fullscreen controls were inspected; this change does not modify the Studio's internal application.

Deployment retains the EC2 environment and runtime state, builds the exact commit on EC2, tests it before activation, preserves previous assets/index for rollback, restarts the backend, and verifies the public index/assets, health, and read-only APIs.
