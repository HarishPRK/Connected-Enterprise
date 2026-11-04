import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2, Network } from 'lucide-react';
import type { Branch, Device, Status } from '../../types';
import type { BranchInventorySource } from '../../ui/deviceInventory';
import { BranchDeviceOrbit } from './BranchDeviceOrbit';
import { DomainInventory } from './DeviceInventory';
import './DeviceTopologyPanel.css';

type Filter = { kind?: Device['kind']; status?: Status };
type Selection = Filter & { branchId: string; domain: Device['domain']; recordId?: string; fromList?: boolean };

export const DeviceTopology = memo(function DeviceTopology({ branch, devices, online, inventorySource }: {
  branch: Branch; devices: Device[]; online?: boolean; inventorySource: BranchInventorySource;
}) {
  const [inspector, setInspector] = useState<Selection | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panel = useRef<HTMLDialogElement>(null);
  const expander = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  if (inspector && inspector.branchId !== branch.id) setInspector(null);
  const inspectDevice = useCallback((device: Device) => setInspector({
    branchId: branch.id, domain: device.domain, recordId: device.id,
  }), [branch.id]);
  const inspectDomain = useCallback((domain: Device['domain'], filter?: Filter) =>
    setInspector({ branchId: branch.id, domain, ...filter }), [branch.id]);
  const openGateway = useCallback(() => { void navigate('/gateway-twin'); }, [navigate]);
  const selectionDomain = inspector?.recordId
    ? devices.find(d => d.id === inspector.recordId)?.domain ?? inspector.domain : inspector?.domain;
  const domainDevices = useMemo(() => devices.filter(d => d.domain === selectionDomain), [devices, selectionDomain]);
  const toggleExpanded = () => {
    const element = panel.current;
    if (!element) return;
    const wasExpanded = element.matches(':modal');
    element.close();
    if (wasExpanded) element.show(); else element.showModal();
    setExpanded(!wasExpanded);
    expander.current?.focus({ preventScroll: true });
  };
  return <section id="device-topology" className="device-fabric" aria-label="Device topology">
    <dialog open ref={panel} role={expanded ? 'dialog' : 'region'} aria-label="Device topology viewer"
      className="device-topology-panel" onCancel={event => { if (expanded) { event.preventDefault(); toggleExpanded(); } }}>
      <header className="device-topology-header">
        <div><h3><Network size={18} aria-hidden="true" />Device topology</h3><p>{branch.gatewayModel} · {branch.id}</p></div>
        <button type="button" ref={expander} onClick={toggleExpanded} aria-expanded={expanded}
          aria-label={expanded ? 'Close expanded device topology' : 'Expand device topology'}>
          {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </header>
      {inventorySource === 'waiting'
        ? <div className="device-topology-waiting" role="status">Waiting for {branch.name} to report its device inventory.</div>
        : <BranchDeviceOrbit devices={devices} branch={branch} online={online}
            onDevice={inspectDevice} onDomain={inspectDomain} onGateway={openGateway} />}
      <footer className="device-topology-meta">
        <span>{branch.name} · {inventorySource === 'gateway' ? 'Gateway inventory' : inventorySource === 'sample' ? 'Sample inventory' : 'Awaiting inventory'}</span>
        <span>One node per device · Logical view</span>
      </footer>
    </dialog>
    {inspector && selectionDomain && <DomainInventory branchName={branch.name} domain={selectionDomain}
      devices={domainDevices} recordId={inspector.recordId} initialKind={inspector.kind} initialStatus={inspector.status}
      route={selectionDomain === 'IT' ? '/it-devices' : '/ot-devices'}
      onDevice={d => setInspector({ ...inspector, branchId: branch.id, domain: d.domain, recordId: d.id, fromList: true })}
      onBack={inspector.fromList ? () => setInspector({ ...inspector, recordId: undefined, fromList: false }) : undefined}
      onClose={() => setInspector(null)} />}
  </section>;
});
