import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import ThemeSwitcher from './components/ThemeSwitcher';
import SolvePage from './pages/SolvePage';
import './index.css';

const queryClient = new QueryClient();

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
          <header style={{
            borderBottom: '1px solid var(--border)',
            padding: '0 24px',
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: 'var(--bg-surface)',
            position: 'sticky',
            top: 0,
            zIndex: 50,
            boxShadow: 'var(--shadow-sm)',
          }}>
            {/* Logo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: 32, height: 32,
                borderRadius: '8px',
                background: 'var(--accent-dim)',
                border: '1px solid var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '16px',
                color: 'var(--accent-text)',
              }}>♠</div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text-primary)', lineHeight: 1.1 }}>
                  TexasSolver
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.1 }}>
                  GTO Web
                </div>
              </div>
            </div>

            <div style={{ flex: 1 }} />

            <ThemeSwitcher />
          </header>

          <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 24px 48px' }}>
            <SolvePage />
          </main>
        </div>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
