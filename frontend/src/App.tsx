import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import { PlayerProvider } from './contexts/PlayerContext';
import AppNav from './components/AppNav';
import SolvePage from './pages/SolvePage';
import HandsPage from './pages/HandsPage';
import StatsPage from './pages/StatsPage';
import TrainerPage from './pages/TrainerPage';
import RangesPage from './pages/RangesPage';
import AIPage from './pages/AIPage';
import './index.css';

const queryClient = new QueryClient();

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <PlayerProvider>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<SolvePage />} />
                <Route path="/trainer" element={<TrainerPage />} />
                <Route path="/hands" element={<HandsPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/ranges" element={<RangesPage />} />
                <Route path="/ai" element={<AIPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PlayerProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function AppLayout() {
  const location = useLocation();
  const isAI = location.pathname === '/ai';
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column' }}>
      <AppNav />
      <main style={isAI
        ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0 24px', position: 'relative' }
        : { maxWidth: '1200px', margin: '0 auto', padding: '24px 24px 48px', width: '100%' }
      }>
        <Outlet />
      </main>
    </div>
  );
}
