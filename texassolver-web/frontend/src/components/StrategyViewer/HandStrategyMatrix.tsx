import { useState } from 'react';
import { RANKS, cellName } from '../../lib/poker';
import {
  aggregateCells, combosForCell, actionColor,
  type CellAggregate,
} from '../../lib/strategyUtils';
import type { ComboStrategy, ActionEntry } from '../../types/solver';

interface Props {
  strategy: ComboStrategy;
  entries: ActionEntry[];
}

interface TooltipState {
  r: number;
  c: number;
  x: number;
  y: number;
}

/** Blend action colors by frequency to produce a single cell color. */
function blendColor(cell: CellAggregate, entries: ActionEntry[]): string {
  // Dominant action color at full/partial opacity based on dominance
  const domEntry = entries[cell.dominantIdx];
  if (!domEntry) return '#30363d';
  const baseColor = actionColor(domEntry.name);
  const dominance = cell.freqs[cell.dominantIdx]; // 0–1
  return baseColor + Math.round(60 + dominance * 195).toString(16).padStart(2, '0');
}

export default function HandStrategyMatrix({ strategy, entries }: Props) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const grid = aggregateCells(strategy, entries.length);

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      {/* Column rank labels */}
      <div style={{ display: 'grid', gridTemplateColumns: '16px repeat(13, 1fr)', gap: '2px', marginBottom: '2px' }}>
        <div />
        {RANKS.map(r => (
          <div key={r} style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', fontWeight: 700 }}>{r}</div>
        ))}
      </div>

      {RANKS.map((rowRank, r) => (
        <div key={rowRank} style={{ display: 'grid', gridTemplateColumns: '16px repeat(13, 1fr)', gap: '2px', marginBottom: '2px' }}>
          {/* Row rank label */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--text-muted)', fontWeight: 700 }}>
            {rowRank}
          </div>
          {RANKS.map((_cr, c) => {
            const cell = grid[r][c];
            const name = cellName(r, c);

            if (!cell) {
              return (
                <div
                  key={c}
                  style={{
                    aspectRatio: '1', borderRadius: '3px',
                    background: 'var(--bg-base)',
                    border: '1px solid var(--bg-base)',
                  }}
                />
              );
            }

            const bg = blendColor(cell, entries);
            const domEntry = entries[cell.dominantIdx];

            return (
              <div
                key={c}
                style={{
                  aspectRatio: '1', borderRadius: '3px',
                  background: bg,
                  border: `1px solid ${bg}`,
                  cursor: 'crosshair',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                }}
                onMouseEnter={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTooltip({ r, c, x: rect.left + rect.width / 2, y: rect.top });
                }}
                onMouseLeave={() => setTooltip(null)}
              >
                {/* Stacked mini-bar at cell bottom */}
                <div style={{ display: 'flex', height: '3px', width: '100%' }}>
                  {entries.map((e, i) => {
                    const freq = cell.freqs[i];
                    if (freq < 0.01) return null;
                    return (
                      <div
                        key={i}
                        style={{
                          height: '100%',
                          width: `${freq * 100}%`,
                          background: actionColor(e.name),
                          flexShrink: 0,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Hand name — only visible at large sizes */}
                <div style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '8px', fontWeight: 700,
                  color: 'rgba(0,0,0,0.6)',
                  pointerEvents: 'none',
                }}>
                  {name}
                </div>
              </div>
            );

            void domEntry; // suppress unused warning
          })}
        </div>
      ))}

      {/* Tooltip */}
      {tooltip && (() => {
        const cell = grid[tooltip.r][tooltip.c];
        if (!cell) return null;
        const details = combosForCell(strategy, tooltip.r, tooltip.c);
        const name = cellName(tooltip.r, tooltip.c);

        return (
          <div style={{
            position: 'fixed',
            left: tooltip.x,
            top: tooltip.y - 8,
            transform: 'translate(-50%, -100%)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '10px 14px',
            fontSize: '11px',
            zIndex: 500,
            boxShadow: 'var(--shadow)',
            pointerEvents: 'none',
            minWidth: '160px',
          }}>
            <div style={{ fontWeight: 800, fontSize: '13px', marginBottom: '6px', color: 'var(--text-primary)' }}>
              {name} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({details.length} combos)</span>
            </div>
            {entries.map((e, i) => {
              const freq = cell.freqs[i];
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '2px', background: actionColor(e.name), flexShrink: 0 }} />
                  <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{e.name}</span>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                    {(freq * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}
    </div>
  );
}
