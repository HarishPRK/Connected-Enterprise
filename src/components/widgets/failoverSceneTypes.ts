export type FailoverSceneKind = 'devices' | 'gateway' | 'fiber' | 'cellular' | 'tunnel' | 'sdwan' | 'internet' | 'cloud';
export type ScenePosition = [number, number, number];

export interface FailoverSceneNode {
  id: string;
  label: string;
  kind: FailoverSceneKind;
  position: ScenePosition;
  color: string;
  status: 'ok' | 'warn' | 'err' | 'idle';
  active?: boolean;
  /** True only for a reachable tunnel with a supported switch command. */
  switchable?: boolean;
  detail: string;
  metrics?: Array<{ label: string; value: string }>;
}

export interface FailoverSceneLink {
  id: string;
  from: string;
  to: string;
  color: string;
  active: boolean;
  available: boolean;
  load?: number;
}

export interface FailoverSceneData {
  nodes: FailoverSceneNode[];
  links: FailoverSceneLink[];
  mode: 'live' | 'target';
  activeLabel: string;
  preview?: boolean;
  route?: FailoverRoutePresentation;
}

export interface FailoverRoutePresentation {
  phase: 'queued' | 'sending' | 'awaiting-ack' | 'awaiting-telemetry' | 'confirmed' | 'failed' | 'unconfirmed' | 'preview';
  pending: boolean;
  requested: string;
  reported: string;
  message: string;
}

export interface FailoverSceneTheme {
  light: boolean;
  text: string;
  muted: string;
  enterprise: string;
  operator: string;
  ok: string;
  warn: string;
  err: string;
}

export interface FailoverSceneRenderer {
  update(data: FailoverSceneData, theme: FailoverSceneTheme): void;
  select(id: string | null): void;
  focus(id: string): void;
  reset(): void;
  zoom(direction: 'in' | 'out'): void;
  setMotion(enabled: boolean): void;
  setOrbit(enabled: boolean): void;
  beginFlowDrag(clientX: number, clientY: number): boolean;
  moveFlowDrag(clientX: number, clientY: number): void;
  endFlowDrag(commit: boolean): void;
  resize(): void;
  dispose(): void;
}
