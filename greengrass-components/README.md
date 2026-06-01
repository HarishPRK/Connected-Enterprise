# RDK path-control Greengrass component

`com.rdk.pathcontrol` — a long-running Greengrass component that lets the cloud
flip the gateway's active WAN path (fiber / 5g / auto) by publishing an MQTT
message, instead of needing direct HTTP access to the gateway's LAN.

## What it does

1. Subscribes (via Greengrass IPC → Nucleus → AWS IoT Core) to
   `<prefix>/path/control`.
2. On a message like `{"mode":"fiber"}`, POSTs to the gateway's local API
   `http://127.0.0.1:8090/api/path`.
3. Publishes the result to `<prefix>/path/control/result`, e.g.
   `{"ok":true,"mode":"fiber","httpStatus":200,"ts":...}`.

`<prefix>` defaults to `rdk` and is set per-deployment via component config, so
the **same artifact** serves both gateway families:

- **Plano gateway** → `topicPrefix: "rdk"`  → listens on `rdk/path/control`
- **McKinney gateway** → `topicPrefix: "prpl"` → listens on `prpl/path/control`

The component never opens its own MQTT connection — it reuses Nucleus's
existing connection through IPC, so no extra certs and no second keepalive.

## Why MQTT (not Lambda / API Gateway)

The gateway sits behind ISP NAT — nothing on the public internet can reach
`127.0.0.1:8090`. But the gateway already holds an *outbound* MQTT connection to
IoT Core (for metrics). This component rides that same connection in reverse.
Lambda/API-GW would still need IoT Core (or a tunnel) to reach the device, so
they'd just be extra moving parts.

## Deploy it

### 1. Publish the component

From the AWS Console → IoT Greengrass → Components → Create component → paste
the recipe (`com.rdk.pathcontrol-1.0.0.json`). Or via CLI:

```bash
aws greengrassv2 create-component-version \
  --inline-recipe fileb://com.rdk.pathcontrol-1.0.0.json \
  --region us-east-1
```

### 2. Add it to your gateway's deployment

Revise the existing `RDKGreengrassDeployment` (the one with Nucleus, Cli,
clientdevices.*). Add `com.rdk.pathcontrol`. In its **configuration to merge**,
set the prefix for that specific gateway:

```json
{ "topicPrefix": "rdk" }
```

For the McKinney/prpl gateway's deployment, use:

```json
{ "topicPrefix": "prpl" }
```

### 3. Grant the IoT policy

The component publishes/subscribes through Nucleus's device cert, so the
**thing's IoT policy** must allow these (in addition to whatever it has):

```json
{
  "Effect": "Allow",
  "Action": ["iot:Subscribe"],
  "Resource": "arn:aws:iot:us-east-1:841019700679:topicfilter/rdk/path/control"
},
{
  "Effect": "Allow",
  "Action": ["iot:Receive"],
  "Resource": "arn:aws:iot:us-east-1:841019700679:topic/rdk/path/control"
},
{
  "Effect": "Allow",
  "Action": ["iot:Publish"],
  "Resource": "arn:aws:iot:us-east-1:841019700679:topic/rdk/path/control/result"
}
```

(Swap `rdk` → `prpl` for the McKinney gateway, or use `*` in dev.)

The IPC authorization is already in the recipe's `accessControl` block — that's
the Greengrass-side permission; the IoT policy above is the cloud-side one.
You need both.

### 4. Verify on the device

```bash
sudo tail -f /greengrass/v2/logs/com.rdk.pathcontrol.log
# expect:
# [pathctl] IPC connected; control=rdk/path/control result=rdk/path/control/result
# [pathctl] subscribed; waiting for commands
```

### 5. Test from the AWS IoT MQTT test client

- **Subscribe** to `rdk/path/control/result`
- **Publish** to `rdk/path/control` with `{"mode":"5g"}`
- You should see the gateway flip and a result message land within ~1 s.

## Wiring the EC2 app to publish

The EC2 app currently has `POST /api/gateway/path` that does an **HTTP** forward
to `GATEWAY_PATH_HOST` — that only works on the gateway's LAN. To make the
buttons work from the cloud, that endpoint needs to **publish to IoT Core**
instead:

- Topic: `rdk/path/control` for Plano, `prpl/path/control` for McKinney
  (derive from the branch the user is viewing — the UI already knows the
  source via `BRANCH_TO_IPSEC_SOURCE`).
- Payload: `{ "mode": "fiber" | "5g" | "auto" }`
- Optionally subscribe to `<prefix>/path/control/result` and stream the ack
  back to the browser so the toast reflects the *real* gateway response, not
  just "message sent."

The server already has an MQTT connection (`server/ipsecSource.ts`) and AWS
creds — the publish can reuse that connection or open a lightweight publisher.
Ask Claude to "wire the EC2 path endpoint to publish to IoT Core" when ready.
