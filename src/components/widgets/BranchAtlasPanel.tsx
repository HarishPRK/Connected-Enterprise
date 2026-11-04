import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

const AtlasView = createContext({ expanded: false, toggle: () => {} });

/** The same canvas stays mounted as the atlas moves into the browser's top layer. */
export function BranchAtlasPanel({ children }: { children: ReactNode }) {
  const panel = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => {
    const element = panel.current;
    if (!element) return;
    const wasExpanded = element.matches(':modal');
    element.close();
    if (wasExpanded) element.show();
    else element.showModal();
    setExpanded(!wasExpanded);
    element.querySelector<HTMLButtonElement>('.branch-atlas-expand')?.focus({ preventScroll: true });
  }, []);

  return <AtlasView.Provider value={{ expanded, toggle }}>
    <dialog open ref={panel} role={expanded ? 'dialog' : 'region'} aria-label="Branch atlas"
      className="branch-atlas" onCancel={event => { if (expanded) { event.preventDefault(); toggle(); } }}>
      {children}
      {expanded && <small className="branch-atlas-credit">
        Imagery: <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/" target="_blank" rel="noreferrer">NASA Earth Observatory / Reto Stöckli</a>
        <span aria-hidden="true">·</span>
        <a href="https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer" target="_blank" rel="noreferrer">USDA / USGS The National Map</a>
      </small>}
    </dialog>
  </AtlasView.Provider>;
}

export function AtlasExpandButton() {
  const { expanded, toggle } = useContext(AtlasView);
  const Icon = expanded ? Minimize2 : Maximize2;
  const label = expanded ? 'Close expanded map' : 'Expand map';
  return <button type="button" className="branch-atlas-expand" onClick={toggle} title={label} aria-label={label} aria-expanded={expanded}>
    <Icon size={15} aria-hidden="true" />
  </button>;
}
