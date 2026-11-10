# EA:GLE device-scoped queries

The Device serial field on `/hardware-anomalies` supplies the `deviceSerial` API parameter. Its default is `R95VA4GP000041`; applying another serial stores it in the page URL. Time-range selection and refresh retain that device. The server validates the serial as a literal identifier and applies `device_serial == selectedDevice` before every aggregation, including reason codes.

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
