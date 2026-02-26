import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './contexts/ThemeContext';
import { PlayerProvider } from './contexts/PlayerContext';
import AppNav from './components/AppNav';
import SolvePage from './pages/SolvePage';
import HandsPage from './pages/HandsPage';
import StatsPage from './pages/StatsPage';
import TrainerPage from './pages/TrainerPage';
import RangesPage from './pages/RangesPage';
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
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <AppNav />
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 24px 48px' }}>
        <Outlet />
      </main>
    </div>
  );
}
