import type { BetSizeConfig } from '../../types/solver';

type Position = 'ip' | 'oop';
type Street = 'flop' | 'turn' | 'river';
type Action = 'bet' | 'raise' | 'donk' | 'allin';

interface Props {
  value: BetSizeConfig[];
  onChange: (cfg: BetSizeConfig[]) => void;
}

const STREETS: Street[] = ['flop', 'turn', 'river'];
const POSITIONS: Position[] = ['oop', 'ip'];
const ACTIONS: { action: Action; label: string }[] = [
  { action: 'bet',   label: 'Bet' },
  { action: 'raise', label: 'Raise' },
  { action: 'donk',  label: 'Donk' },
  { action: 'allin', label: 'All-in' },
];

const POSITION_LABELS: Record<Position, string> = { oop: 'OOP', ip: 'IP' };
const STREET_LABELS: Record<Street, string>     = { flop: 'Flop', turn: 'Turn', river: 'River' };

function findCfg(cfgs: BetSizeConfig[], pos: Position, street: Street, action: Action) {
  return cfgs.find(c => c.position === pos && c.street === street && c.action === action);
}

function upsert(cfgs: BetSizeConfig[], next: BetSizeConfig): BetSizeConfig[] {
  const idx = cfgs.findIndex(c => c.position === next.position && c.street === next.street && c.action === next.action);
  if (idx === -1) return [...cfgs, next];
  const copy = [...cfgs];
  copy[idx] = next;
  return copy;
}

function remove(cfgs: BetSizeConfig[], pos: Position, street: Street, action: Action): BetSizeConfig[] {
  return cfgs.filter(c => !(c.position === pos && c.street === street && c.action === action));
}

const SUGGESTED = [25, 33, 50, 67, 75, 100, 125, 150, 200];

export default function BetTreeBuilder({ value, onChange }: Props) {
  const [activeStreet, setActiveStreet] = useState<Street>('flop');

  const toggleAllin = (pos: Position, street: Street) => {
    const existing = findCfg(value, pos, street, 'allin');
    if (existing) {
      onChange(remove(value, pos, street, 'allin'));
    } else {
      onChange(upsert(value, { position: pos, street, action: 'allin', sizes: [] }));
    }
  };

  const addSize = (pos: Position, street: Street, action: Action, size: number) => {
    const existing = findCfg(value, pos, street, action);
    if (existing && existing.sizes.includes(size)) return;
    const sizes = existing ? [...existing.sizes, size].sort((a, b) => a - b) : [size];
    onChange(upsert(value, { position: pos, street, action, sizes }));
  };

  const removeSize = (pos: Position, street: Street, action: Action, size: number) => {
    const existing = findCfg(value, pos, street, action);
    if (!existing) return;
    const sizes = existing.sizes.filter(s => s !== size);
    if (sizes.length === 0) {
      onChange(remove(value, pos, street, action));
    } else {
      onChange(upsert(value, { ...existing, sizes }));
    }
  };

  const handleCustomSize = (pos: Position, street: Street, action: Action, raw: string) => {
    const num = parseInt(raw, 10);
    if (!isNaN(num) && num > 0 && num <= 5000) addSize(pos, street, action, num);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Street tabs */}
      <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-base)', borderRadius: '10px', padding: '4px' }}>
        {STREETS.map(s => (
          <button
            key={s}
            onClick={() => setActiveStreet(s)}
            style={{
              flex: 1,
              padding: '7px 0',
              borderRadius: '7px',
              border: 'none',
              background: activeStreet === s ? 'var(--accent)' : 'transparent',
              color: activeStreet === s ? 'var(--bg-base)' : 'var(--text-secondary)',
              fontWeight: 700,
              fontSize: '13px',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {STREET_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Per-position configuration */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        {POSITIONS.map(pos => (
          <div key={pos} style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            {/* Position header */}
            <div style={{
              fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)',
              paddingBottom: '8px', borderBottom: '1px solid var(--border-subtle)',
            }}>
              {POSITION_LABELS[pos]}
            </div>

            {/* Action rows */}
            {ACTIONS.filter(a => !(a.action === 'donk' && (pos === 'ip' || activeStreet === 'flop'))).map(({ action, label }) => {
              if (action === 'allin') {
                const active = !!findCfg(value, pos, activeStreet, 'allin');
                return (
                  <div key={action} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
                    <button
                      onClick={() => toggleAllin(pos, activeStreet)}
                      style={{
                        padding: '3px 10px',
                        borderRadius: '6px',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        background: active ? 'var(--accent-dim)' : 'transparent',
                        color: active ? 'var(--accent-text)' : 'var(--text-muted)',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.12s',
                      }}
                    >
                      {active ? 'On ✓' : 'Off'}
                    </button>
                  </div>
                );
              }

              const cfg = findCfg(value, pos, activeStreet, action);
              const sizes = cfg?.sizes ?? [];

              return (
                <div key={action} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>

                  {/* Current sizes */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {sizes.map(s => (
                      <span key={s} style={{
                        display: 'inline-flex', alignItems: 'center', gap: '3px',
                        padding: '2px 7px', borderRadius: '999px',
                        background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                        color: 'var(--accent-text)', fontSize: '11px', fontWeight: 700,
                      }}>
                        {s}%
                        <button
                          onClick={() => removeSize(pos, activeStreet, action, s)}
                          style={{ border: 'none', background: 'none', color: 'var(--accent-text)', cursor: 'pointer', padding: 0, fontSize: '11px', lineHeight: 1, opacity: 0.7 }}
                        >×</button>
                      </span>
                    ))}
                    {sizes.length === 0 && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>none</span>
                    )}
                  </div>

                  {/* Suggested sizes */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                    {SUGGESTED.map(s => {
                      const already = sizes.includes(s);
                      return (
                        <button
                          key={s}
                          onClick={() => already ? removeSize(pos, activeStreet, action, s) : addSize(pos, activeStreet, action, s)}
                          style={{
                            padding: '2px 7px', borderRadius: '5px',
                            border: '1px solid var(--border)',
                            background: already ? 'var(--bg-hover)' : 'transparent',
                            color: already ? 'var(--text-secondary)' : 'var(--text-muted)',
                            fontSize: '11px',
                            cursor: 'pointer',
                            transition: 'all 0.1s',
                            textDecoration: already ? 'line-through' : 'none',
                          }}
                        >
                          {s}%
                        </button>
                      );
                    })}
                    {/* Custom input */}
                    <input
                      type="number"
                      min={1}
                      max={5000}
                      placeholder="…"
                      style={{
                        width: 44, padding: '2px 5px', borderRadius: '5px',
                        border: '1px solid var(--border)', background: 'var(--bg-base)',
                        color: 'var(--text-primary)', fontSize: '11px', outline: 'none',
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          handleCustomSize(pos, activeStreet, action, e.currentTarget.value);
                          e.currentTarget.value = '';
                        }
                      }}
                      onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--border)')}
                      title="Type a custom size % and press Enter"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
