import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './App.css'
import App from './App.tsx'
import { ThemeProvider } from './ui/Theme'

const root = createRoot(document.getElementById('root')!);
function render(initialOverview?: typeof import('./pages/Overview').Overview) {
  root.render(
    <StrictMode>
      <ThemeProvider>
        <BrowserRouter>
          <App initialOverview={initialOverview} />
        </BrowserRouter>
      </ThemeProvider>
    </StrictMode>,
  );
}

// Resolve Home before its first React commit, avoiding the initial Suspense
// fallback's retry delay. Other entry routes retain their existing lazy load.
if (window.location.pathname === '/') {
  void import('./pages/Overview').then(({ Overview }) => render(Overview), () => render());
} else {
  render();
}
