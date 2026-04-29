import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.jsx'

async function clearStalePwaCache() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.includes('workbox') || name.includes('precache')).map((name) => caches.delete(name)));
    }
  } catch (error) {
    console.warn('Trade Pilot cache cleanup failed', error);
  }
}

class TradePilotErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Trade Pilot render error', error, info);
  }

  resetWorkspace = () => {
    [
      'tradePilotActivePosition',
      'tradePilotConnectionSettings',
      'tradePilotDiscipline',
      'tradePilotLayout',
      'tradePilotProfile',
      'tradePilotWatchlist',
    ].forEach((key) => localStorage.removeItem(key));
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main style={{
        background: '#05070d',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif',
        minHeight: '100vh',
        padding: '32px',
      }}>
        <section style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '16px',
          margin: '10vh auto 0',
          maxWidth: '720px',
          padding: '28px',
        }}>
          <p style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Trade Pilot Recovery</p>
          <h1 style={{ fontSize: '28px', margin: '8px 0 12px' }}>Dashboard hit a saved-state error.</h1>
          <p style={{ color: '#cbd5e1', lineHeight: 1.6 }}>The app loaded, but an old saved workspace caused a render crash. Resetting the local workspace clears cached settings and keeps your account intact.</p>
          <button onClick={this.resetWorkspace} style={{
            background: '#2563eb',
            border: '0',
            borderRadius: '10px',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 800,
            marginTop: '18px',
            padding: '12px 16px',
          }}>Reset local workspace</button>
          <pre style={{ background: '#020617', borderRadius: '10px', color: '#fecaca', marginTop: '18px', overflow: 'auto', padding: '12px' }}>{String(this.state.error?.message || this.state.error)}</pre>
        </section>
      </main>
    );
  }
}

clearStalePwaCache();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TradePilotErrorBoundary>
      <App />
    </TradePilotErrorBoundary>
  </StrictMode>,
)
