import { Component, Suspense, type ReactNode } from 'react';

let available: boolean | undefined;

function supportsWebGL2() {
  if (available !== undefined) return available;
  try {
    const context = document.createElement('canvas').getContext('webgl2');
    available = context !== null;
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    available = false;
  }
  return available;
}

interface Props {
  children: ReactNode;
  fallback: ReactNode;
  loading?: ReactNode;
}

/** Keep the map or inventory usable when its graphics driver or scene asset fails. */
export class StudioSceneBoundary extends Component<Props, { ready: boolean; failed: boolean }> {
  state = { ready: false, failed: false };
  private host: HTMLDivElement | null = null;
  private observer?: IntersectionObserver;

  static getDerivedStateFromError() {
    return { failed: true };
  }

  private enableScene = () => {
    this.observer?.disconnect();
    if (supportsWebGL2()) this.setState({ ready: true });
    else this.setState({ failed: true });
  };

  private handleContextLoss = () => this.setState({ failed: true });

  componentDidMount() {
    const host = this.host;
    if (!host) return;
    host.addEventListener('webglcontextlost', this.handleContextLoss, true);
    if (typeof IntersectionObserver === 'undefined') {
      this.enableScene();
      return;
    }
    this.observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) this.enableScene();
    }, { rootMargin: '120px' });
    this.observer.observe(host);
  }

  componentWillUnmount() {
    this.observer?.disconnect();
    this.host?.removeEventListener('webglcontextlost', this.handleContextLoss, true);
  }

  render() {
    const { children, fallback, loading = fallback } = this.props;
    const { ready, failed } = this.state;
    return <div className="studio-scene-boundary" ref={node => { this.host = node; }}>
      {failed ? fallback : ready ? <Suspense fallback={loading}>{children}</Suspense> : loading}
    </div>;
  }
}
