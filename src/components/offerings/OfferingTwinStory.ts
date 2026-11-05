const ramp = (time: number, start: number, end: number) => {
  const u = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return u * u * (3 - 2 * u);
};

/** Scripted diagnostic example, never a live gateway command or actual log. */
export function sampleTwin(time: number) {
  const stage = time < 4 ? 'observe' : time < 7 ? 'log' : time < 11.4 ? 'locate'
    : time < 15.4 ? 'repair' : time < 17 ? 'verify' : 'resolved';
  const resolved = stage === 'resolved';
  return {
    stage, resolved,
    port: 'LAN 1',
    color: resolved ? '#8ce3c6' : stage === 'verify' ? '#ffc885' : '#ff897a',
    log: resolved ? 'LAN 1  LINK UP · 1 Gbps' : time < 4 ? 'CHECKOUT 01  Connectivity alert' : 'LAN 1  LINK FLAP · repeated disconnects',
    action: stage === 'observe' ? 'Open gateway diagnostics' : stage === 'log' ? 'Select the interface in the error log'
      : stage === 'locate' ? 'Twin highlights LAN 1 on the port panel' : stage === 'repair' ? 'Check and reseat the LAN 1 connector'
        : stage === 'verify' ? 'Testing link stability and checkout reachability' : 'Stable link · Checkout reachable',
    highlight: time >= 7,
    // Pull the actual plug out and return it before validating connectivity.
    unplug: ramp(time,13.6,14.15)*(1-ramp(time,14.55,15.15)),
    reach: ramp(time,11.4,12.2)*(1-ramp(time,15.4,16.1)),
    typing: (1-ramp(time,8.5,9)) + ramp(time,20,20.5),
    virtualExplode: ramp(time,7,9)*(1-ramp(time,11.5,13)),
  };
}
