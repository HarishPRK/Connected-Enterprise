# EA:GLE visual states

The status panel retains exact Influx reason codes, series tags and timestamps. Its expandable reference lists the mappings from `shared/eagleTelemetry.ts`. HTTP Cats provide visual reactions alongside the real detector code. The HTTP code printed on a meme never replaces a detector code or represents an actual API response.

| Snapshot condition | HTTP Cat |
| --- | --- |
| Complete normal readings with a reason report | 200 OK |
| Nonzero reason code, raised flag or threshold crossing | 500 Internal Server Error |
| Missing or incomplete readings | 404 Not Found |
| Query failure or cached snapshot after a failed refresh | 503 Service Unavailable |

HTTP 400 is excluded at the user's request. No corresponding image, import or runtime mapping is included. The original illustrated sprite has been removed from the active application. Empty graph panels use the 404 photo; query error panels use 503.

The photos have a single 400ms entrance on state change; there are no repeating image animations. The page motion control and reduced-motion preference disable it. Chart entrance transitions are bounded at 500ms; no continuous chart or data animation is used.

Graph legends show the latest returned value per series and can toggle each signal. At least one series stays visible. Flag means use a separate 0–1 right axis; the primary MSE chart retains its existing fixed 0–2 axis. Hover and keyboard inspection share timestamps across charts. The sample history groups at most 80 display segments from actual samples, preserving each bin's most severe state. Missing values are incomplete rather than healthy.

## Image credits

The four unchanged JPGs in `src/assets/eagle/http-cat-*.jpg` come from [HTTP Cats](https://http.cat/), using its documented `https://http.cat/<code>.jpg` endpoints. Images are bundled locally for reliable loading, without third-party requests from the dashboard. Original images credited by HTTP Cats to **Tomomi Imura (@girlie_mac)**; site by **Rogério Vicente (@rogeriopvl)** and contributors.

Source repository: https://github.com/httpcats/http.cat. Its MIT license is retained in `src/assets/eagle/HTTP-CATS-LICENSE.txt`. The dashboard displays only the cat image, without a visible caption or source link; attribution is retained here.
