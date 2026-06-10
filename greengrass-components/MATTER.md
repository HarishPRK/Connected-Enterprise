# RDK Matter Greengrass components (Plano)

Two new components for the Filogic RDK gateway (`RDKGreengrassThing`) that
expose the local Matter hub (`http://192.168.1.201:8089/cgi-bin/matterapi.ha`)
to the cloud. They feed the IT/OT Devices view for the Plano location and keep
working through dynamic fiber/5G failover: every publish is a fresh, short
HTTPS request through the IoT data endpoint, so there is no long-lived MQTT
session to go stale when the WAN path flips.

| File | Component | What it does |
|---|---|---|
| `com.rdk.matter.devicelist-1.0.1.json` | `com.rdk.matter.devicelist` | Every 30 s, `GET_DEVICES_LIST` from the hub → publish raw response to `rdk/matter/devices/list` |
| `com.rdk.matter.devicecontrol-1.0.1.json` | `com.rdk.matter.devicecontrol` | Polls the `RDKMatterControl` thing shadow every 3 s, forwards `desired.command` to the hub, publishes the outcome to `rdk/matter/device/control/result`, clears the shadow |

Deploy the **1.0.1** recipes — 1.0.0 is superseded: the Filogic gateway's
Nucleus runs lifecycle scripts with a PATH that misses `/usr/bin`, so 1.0.1
exports a sane PATH first (otherwise every `curl`/`python3` call fails with
`not found`).

## Topics (unique across the existing `rdk/` namespace)

Already taken: `rdk/ipsec/metrics`, `rdk/path/control`, `rdk/path/control/result`,
`rdk/devices/inventory`. The Matter family uses its own sub-namespace:

| Purpose | You (cloud / MQTT test client) | Topic |
|---|---|---|
| Receive device list | **Subscribe** | `rdk/matter/devices/list` |
| Send a control command | **Publish** | `$aws/things/RDKMatterControl/shadow/update` |
| Receive control result | **Subscribe** | `rdk/matter/device/control/result` |

Control rides a thing shadow because the components talk to IoT Core over the
HTTPS REST API with the Nucleus certs (publish-only — REST cannot subscribe).
This is the same pattern as the existing `SmartHomeOnboarding` onboarding flow.

## Control command contract

Publish a shadow update whose `desired.command` carries `requestId` (echoed
back in the result), `cmd` (used as the CGI query string, defaults to
`CONTROL_DEVICE`), and any other fields, which are passed through verbatim as
the JSON body to `matterapi.ha?<cmd>`:

```json
{
  "state": {
    "desired": {
      "command": {
        "requestId": "ctl-001",
        "cmd": "CONTROL_DEVICE",
        "nodeId": 21,
        "endpointId": 1,
        "cluster": "OnOff",
        "action": "Toggle"
      }
    }
  }
}
```

Result on `rdk/matter/device/control/result`:

```json
{ "requestId": "ctl-001", "success": true, "hubResponse": { "...": "hub reply" } }
```

The exact control grammar of `matterapi.ha` is not recorded in this repo —
verify it once on the gateway before relying on a payload shape:

```sh
curl -v -H "Content-Type: application/json" \
  --data-raw '{"cmd":"CONTROL_DEVICE","nodeId":21,"endpointId":1,"cluster":"OnOff","action":"Toggle"}' \
  "http://192.168.1.201:8089/cgi-bin/matterapi.ha?CONTROL_DEVICE"
```

Whatever shape works there is exactly what you put in `desired.command`.

## Deploy

1. Create the control thing (no cert needed, shadow only):

   ```sh
   aws iot create-thing --thing-name RDKMatterControl --region us-east-1
   ```

2. Publish both components:

   ```sh
   aws greengrassv2 create-component-version \
     --inline-recipe fileb://com.rdk.matter.devicelist-1.0.1.json --region us-east-1
   aws greengrassv2 create-component-version \
     --inline-recipe fileb://com.rdk.matter.devicecontrol-1.0.1.json --region us-east-1
   ```

3. Revise the gateway's deployment (`RDKGreengrassDeployment`) and add both
   components. All endpoints, cert paths, topics, and intervals are in
   `DefaultConfiguration`, overridable per deployment via configuration merge.

4. Make sure the core's IoT policy allows:

   ```json
   { "Effect": "Allow", "Action": ["iot:Publish"],
     "Resource": [
       "arn:aws:iot:us-east-1:841019700679:topic/rdk/matter/devices/list",
       "arn:aws:iot:us-east-1:841019700679:topic/rdk/matter/device/control/result"
     ] },
   { "Effect": "Allow", "Action": ["iot:GetThingShadow", "iot:UpdateThingShadow"],
     "Resource": "arn:aws:iot:us-east-1:841019700679:thing/RDKMatterControl" }
   ```

5. Cloud side: the EC2 dashboard server (`server/ipsecSource.ts`) subscribes to
   `rdk/matter/devices/list` on its existing MQTT-WebSocket connection. Its IAM
   policy needs `iot:Subscribe` on
   `arn:aws:iot:us-east-1:841019700679:topicfilter/rdk/matter/devices/list` and
   `iot:Receive` on `...:topic/rdk/matter/devices/list` (no-op if it already
   uses a wildcard — same grant family as `rdk/devices/inventory`). An
   unauthorized subscribe makes IoT Core drop the whole connection, taking the
   ipsec-metrics and path-control feeds down with it.

## Verify

```sh
tail -f /greengrass/v2/logs/com.rdk.matter.devicelist.log
tail -f /greengrass/v2/logs/com.rdk.matter.devicecontrol.log
```

From the AWS IoT MQTT test client: subscribe to `rdk/matter/devices/list`
(list arrives within 30 s) and `rdk/matter/device/control/result`, then publish
the shadow update above to `$aws/things/RDKMatterControl/shadow/update` and
watch the result land.

## Notes

- Cert paths come from `/opt/persistent/greengrass/config.yaml` (the
  `/greengrass/368dc…` files). If a component logs a cert read error, either
  point `certPath`/`keyPath` at `/opt/persistent/greengrass/...` via config
  merge or keep `RequiresPrivilege: true` (the default in these recipes).
- Wiring into the Devices page: the server's "Phase 1" plan
  (`server/index.ts`, device inventory section) subscribes to live gateway
  data. Subscribe `ipsecSource`/`deviceSource` to `rdk/matter/devices/list`
  and map hub entries into the `rdk/devices/inventory` contract
  (`{ gateway, ts, devices: [{ mac, hostname, services: ["_matter._tcp"], ... }] }`)
  so Matter devices auto-classify as OT.
