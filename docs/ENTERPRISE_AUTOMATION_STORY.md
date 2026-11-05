# Enterprise device automation: closing routine

The offerings film is an illustrative 60-second sequence (24 story units). It does not send device commands. The employee requests closure on a tablet, leaves, and the console verifies vacancy before switching three selected loads. The occupied variant withholds every command while the employee continues working. Refrigeration, networking and separate walkway lighting are excluded from the routine.

## Existing integration boundaries

- `server/index.ts` exposes Matter and Shelly On/Off controls. It does not expose generic dimming, thermostat setpoints or access-control commands.
- Matter commands in `server/ipsecSource.ts` travel over MQTT to the gateway component and onward to its Matter hub. The inventory parser in `server/deviceSource.ts` distinguishes Thread devices (`radioType: 2`) from Wi-Fi devices. The model's plugs are brand-neutral, not exact replicas of the configured lab devices.
- Shelly Plus 1PM devices connect directly to the configured MQTT broker. `Switch.Set` has a correlated reply; switch-state and electrical readings are also consumed. The story must not imply that this current cloud-connected implementation works entirely offline at the gateway.
- The Zigbee presence sensor, bridge, vacancy dwell and coordinated rule are proposed extensions illustrated by the scene. No corresponding Zigbee adapter or automation engine was found in the current application. Zigbee/Modbus/BACnet inventory classification hints do not establish implemented control support.
- A command reply and an observed state are distinct. The film confirms the two Matter loads from their Off states. It confirms the Shelly sign only after Off state and the illustrative circuit-power readback agree. The 120 W to 0 W values describe the example sign circuit, not the relay's own standby consumption or live telemetry.
- The vacancy dwell is compressed for storytelling. The scene does not establish that a presence sensor alone is sufficient evidence of building vacancy, and does not control locks or life-safety equipment.

## Timeline contract

`OfferingAutomationStory.ts` owns the shared clock. Closure is requested at 3; the employee exits at 8.5; the door closes at 9; vacancy is verified at 10.5. Display request/acknowledgement/state occur at 11/11.7/12; desk lamp at 12.5/13.2/13.5; sign at 14/14.6/14.9. Sign power settles during 15–16; the routine completes at 16.5. The occupied variant never issues any of these device requests. Film captions use the same sampler and timing constants.

## Protocol and device references

- [Thread Group: border router vs. hub or bridge](https://threadgroup.org/Newsroom/Blog/what-is-a-thread-border-router-and-how-is-it-different-from-a-hub-or-a-bridge): a Thread border router forwards IP traffic; it does not translate Matter into another application protocol.
- [Thread Group: Thread benefits](https://threadgroup.org/What-is-Thread/Thread-Benefits): Thread is an IPv6 mesh network and is application-layer agnostic. Matter can operate over both Thread and Wi-Fi.
- [Connectivity Standards Alliance: Matter](https://csa-iot.org/all-solutions/matter/): the common application model enables compatible devices from different manufacturers to interoperate.
- [Connectivity Standards Alliance: Zigbee](https://csa-iot.org/all-solutions/zigbee/): Zigbee is a distinct IoT technology; the scene represents a separate bridge for the proposed presence integration.
- [Shelly Plus 1PM product documentation](https://kb.shelly.cloud/knowledge-base/shelly-plus-1pm): Wi-Fi switch with power measurement and MQTT support. Shelly is the manufacturer, not a protocol.
- [Shelly Switch RPC](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch/): `Switch.Set` requests an On or Off output; status is a separate observation.
- [Shelly RPC channels](https://shelly-api-docs.shelly.cloud/gen2/General/RPCChannels/): RPC may travel over MQTT through a broker. Other channel support does not imply that this application uses those channels.

Reviewed against application source and official documentation on 2026-11-05.
