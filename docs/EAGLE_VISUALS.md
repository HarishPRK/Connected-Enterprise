# EA:GLE visual states

The status panel retains exact Influx reason codes, series tags and timestamps. Its expandable reference lists the mappings from `shared/eagleTelemetry.ts`. Status, empty and error panels use operational text without cat reactions, labels or HTTP status imagery. The status panel uses the full available width.

Chart entrance transitions are bounded at 500ms; no continuous chart or data animation is used. The page motion control and reduced-motion preference disable these transitions.

Graph legends show the latest returned value per series and can toggle each signal. At least one series stays visible. Flag means use a separate 0–1 right axis; the primary MSE chart retains its existing fixed 0–2 axis. Hover and keyboard inspection share timestamps across charts. The sample history groups at most 80 display segments from actual samples, preserving each bin's most severe state. Missing values are incomplete rather than healthy.
