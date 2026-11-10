# EA:GLE device-scoped queries

The Device serial dropdown on `/hardware-anomalies` lists devices returned by `GET /api/hardware-metrics/devices`. Selecting an option immediately loads that device's metrics and stores `deviceSerial` in the page URL. Time-range selection and refresh retain that device. The server validates the serial as a literal identifier and applies `device_serial == selectedDevice` before every aggregation, including reason codes.

Discovery uses [Influx schema.measurementTagValues](https://docs.influxdata.com/flux/v0/stdlib/influxdata/influxdb/schema/measurementtagvalues/) for the `device_serial` tag on `hardware_metrics`, with `start: time(v: 0)` to include all retained history rather than only the default 30 days. Results are sorted, deduplicated and restricted to identifiers supported by the metrics endpoint; `NULL` and `UNKNOWN` placeholder tags are omitted. No credentials or arbitrary Flux are accepted from the browser. Discovery shares the metrics request concurrency, timeout, cancellation and response-size limits.

Without a URL selection, the page chooses `R95VA4GP000041` when available, otherwise the first discovered device. An unavailable URL selection prompts the user to choose an available device; it never silently shows another device's data. Empty lists and discovery failures have explicit states and a retry control. Changing devices cancels outstanding metric requests and clears the previous device's charts. Refresh devices reloads the catalog without changing the time range.

Data source: the server-configured Influx bucket (default `BGW620`), `_measurement = hardware_metrics`, `_field = value`. Influx credentials remain server-only.

| View | Metric tag values | Aggregation |
| --- | --- | --- |
| Existing anomaly summary | `anomaly_flag` | `max` by default; API also supports `last` |
| Existing MSE / threshold trace | `anomaly_mse`, `anomaly_threshold` | `mean` by default; API also supports `last` |
| Reason codes | `anomaly_reason_code` | Latest sample per tagged series |
| Anomaly metrics | `anomaly_mse`, `anomaly_threshold`, `anomaly_flag`, `anomaly_raw_flag` | Window mean |
| Connection tracking | `conntrack_total`, `conntrack_tcp`, `conntrack_udp`, `conntrack_icmp`, `conntrack_other` | Window mean |

Both new metric queries use `aggregateWindow(every: selectedWindow, fn: mean, createEmpty: false)`. The app substitutes its time range and window for Grafana's `v.timeRangeStart`, `v.timeRangeStop`, and `v.windowPeriod`. The new anomaly result is named `anomaly_metrics` to distinguish it from the existing summary result; `yield(name: "last")` is a result name, not a last-value aggregation.

Confirmed and raw flag means remain numeric (including fractional values such as `0.25`). They are displayed separately from the existing max-aggregated summary, so the new means cannot overwrite the summary's flag or value aggregation. Tags distinguish series; missing metrics remain missing and display an empty state rather than synthetic zeroes.

Examples:

```text
/hardware-anomalies?deviceSerial=R95VA4GP000041
/api/hardware-metrics/anomalies?deviceSerial=R95VA4GP000041&start=-24h&window=5m
```

Query behavior follows [Influx aggregateWindow](https://docs.influxdata.com/flux/v0/stdlib/universe/aggregatewindow/) and [Grafana's Flux variable interpolation](https://grafana.com/docs/grafana/latest/datasources/influxdb/query-editor/).
