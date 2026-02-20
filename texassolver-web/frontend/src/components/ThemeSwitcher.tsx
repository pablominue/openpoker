import { useState, useRef, useEffect } from 'react';
import { THEMES, useTheme } from '../contexts/ThemeContext';

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = THEMES.find(t => t.id === theme)!;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Switch theme"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 12px',
          borderRadius: '8px',
          border: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 500,
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: current.preview,
            display: 'inline-block',
            flexShrink: 0,
          }}
        />
        <span>{current.label}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '12px',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            minWidth: '140px',
            zIndex: 100,
            boxShadow: 'var(--shadow)',
          }}
        >
          {THEMES.map(t => (
            <button
              key={t.id}
              onClick={() => { setTheme(t.id); setOpen(false); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 10px',
                borderRadius: '8px',
                border: 'none',
                background: t.id === theme ? 'var(--accent-dim)' : 'transparent',
                color: t.id === theme ? 'var(--accent-text)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: t.id === theme ? 600 : 400,
                textAlign: 'left',
                width: '100%',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => { if (t.id !== theme) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { if (t.id !== theme) e.currentTarget.style.background = 'transparent'; }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: t.preview,
                  border: t.id === theme ? '2px solid var(--accent-text)' : '2px solid transparent',
                  flexShrink: 0,
                }}
              />
              <span>{t.icon} {t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
