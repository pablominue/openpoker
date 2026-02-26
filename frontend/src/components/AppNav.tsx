import { NavLink } from 'react-router-dom';
import { usePlayer } from '../contexts/PlayerContext';
import ThemeSwitcher from './ThemeSwitcher';
import { useState, useRef, useEffect } from 'react';

const NAV_LINKS = [
  { to: '/', label: 'Solver' },
  { to: '/trainer', label: 'Trainer' },
  { to: '/hands', label: 'Hands' },
  { to: '/stats', label: 'Stats' },
  { to: '/ranges', label: 'Ranges' },
];

export default function AppNav() {
  const { players, selectedPlayer, setSelectedPlayer } = usePlayer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectPlayer = (name: string) => {
    setSelectedPlayer(name);
    setMenuOpen(false);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customName.trim()) {
      setSelectedPlayer(customName.trim());
      setCustomName('');
      setMenuOpen(false);
    }
  };

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 24px', height: '56px',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      boxShadow: 'var(--shadow-sm)',
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        <span style={{ fontSize: '20px', color: 'var(--accent)' }}>♠</span>
        <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          OpenPoker
        </span>
      </div>

      {/* Nav links */}
      <nav style={{ display: 'flex', gap: '4px' }}>
        {NAV_LINKS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              padding: '6px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: isActive ? 700 : 500,
              color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
              background: isActive ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
              textDecoration: 'none',
              transition: 'all 0.12s',
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Right: theme + player selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <ThemeSwitcher />

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '5px 10px', borderRadius: '8px',
              border: '1px solid var(--border)',
              background: selectedPlayer ? 'var(--accent-dim)' : 'var(--bg-elevated)',
              color: selectedPlayer ? 'var(--accent-text)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: '12px', fontWeight: 600,
            }}
          >
            <span style={{
              width: 22, height: 22, borderRadius: '50%',
              background: selectedPlayer ? 'var(--accent)' : 'var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '11px', color: selectedPlayer ? '#fff' : 'var(--text-muted)',
              flexShrink: 0,
            }}>
              {selectedPlayer ? selectedPlayer[0].toUpperCase() : '?'}
            </span>
            {selectedPlayer || 'Select player'}
            <span style={{ fontSize: '10px', opacity: 0.6 }}>▾</span>
          </button>

          {menuOpen && (
            <div style={{
              position: 'absolute', right: 0, top: '110%', minWidth: 200,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: '10px', boxShadow: 'var(--shadow)', overflow: 'hidden', zIndex: 200,
            }}>
              {players.length > 0 && (
                <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div style={{ padding: '4px 12px', fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Players
                  </div>
                  {players.map(name => (
                    <button
                      key={name}
                      onClick={() => handleSelectPlayer(name)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        width: '100%', textAlign: 'left',
                        padding: '8px 12px', background: name === selectedPlayer ? 'var(--accent-dim)' : 'none',
                        border: 'none', color: name === selectedPlayer ? 'var(--accent-text)' : 'var(--text-primary)',
                        fontSize: '13px', cursor: 'pointer', fontWeight: name === selectedPlayer ? 700 : 400,
                      }}
                    >
                      <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#fff', flexShrink: 0 }}>
                        {name[0].toUpperCase()}
                      </span>
                      {name}
                      {name === selectedPlayer && <span style={{ marginLeft: 'auto', fontSize: '11px' }}>✓</span>}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleCustomSubmit} style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                  {players.length === 0 ? 'Enter your PokerStars name' : 'Add player'}
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    value={customName}
                    onChange={e => setCustomName(e.target.value)}
                    placeholder="Username"
                    style={{
                      flex: 1, padding: '5px 8px', borderRadius: '6px',
                      border: '1px solid var(--border)', background: 'var(--bg-base)',
                      color: 'var(--text-primary)', fontSize: '12px', outline: 'none',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!customName.trim()}
                    style={{
                      padding: '5px 10px', borderRadius: '6px',
                      background: 'var(--accent)', color: '#fff', border: 'none',
                      cursor: customName.trim() ? 'pointer' : 'not-allowed',
                      fontSize: '12px', fontWeight: 600, opacity: customName.trim() ? 1 : 0.5,
                    }}
                  >
                    Set
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
