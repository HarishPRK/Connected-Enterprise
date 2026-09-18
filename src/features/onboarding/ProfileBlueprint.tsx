import { Cable, Globe2, Router, ShieldCheck, Signal } from 'lucide-react';
import type { ProfileVersion } from './types';

function setting(value: unknown) {
  return value === true ? 'Enabled' : value === false ? 'Disabled' : 'Not specified';
}

export function ProfileBlueprint({ profile }: { profile: ProfileVersion }) {
  const p = profile.parameters;
  const lan = p.lanIpAddress ? `${p.lanIpAddress}${p.lanPrefixLength !== undefined ? `/${p.lanPrefixLength}` : ''}` : 'Not specified';
  return (
    <section className="ce-onb-blueprint" aria-label="Profile network summary">
      <div className="ce-onb-blueprint-heading"><h4>Network at a glance</h4><span>From this profile</span></div>
      <div className="ce-onb-network-path">
        <div><Globe2 size={23} aria-hidden="true" /><span>WAN uplink</span><strong>{p.wanMode === 'DHCP' ? 'Automatic · DHCP' : p.wanMode === 'STATIC' ? String(p.wanStaticIpAddress || 'Static IPv4') : 'Not specified'}</strong></div>
        <span className="ce-onb-network-wire" aria-hidden="true" />
        <div className="ce-onb-network-gateway"><Router size={26} aria-hidden="true" /><span>Gateway LAN</span><strong className="mono">{lan}</strong></div>
        <span className="ce-onb-network-wire is-standby" aria-hidden="true" />
        <div><Signal size={23} aria-hidden="true" /><span>Cellular backup</span><strong>{setting(p.cellularBackupEnabled)}</strong></div>
      </div>
      <div className="ce-onb-network-policies">
        <span><Cable size={13} aria-hidden="true" />DHCP server<strong>{setting(p.dhcpServerEnabled)}</strong></span>
        <span><ShieldCheck size={13} aria-hidden="true" />Management-loss rollback<strong>{setting(p.rollbackOnManagementLoss)}</strong></span>
      </div>
    </section>
  );
}
