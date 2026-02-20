import type { ActionAggregate } from '../../lib/strategyUtils';

interface Props {
  aggregates: ActionAggregate[];
}

export default function ActionBreakdown({ aggregates }: Props) {
  const total = aggregates.reduce((s, a) => s + a.freq, 0);
  // Normalise in case of floating point drift
  const normalised = aggregates.map(a => ({
    ...a,
    pct: total > 0 ? (a.freq / total) * 100 : 0,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Stacked bar */}
      <div style={{
        height: 14,
        borderRadius: '4px',
        overflow: 'hidden',
        display: 'flex',
        width: '100%',
        background: 'var(--bg-base)',
      }}>
        {normalised.map((a, i) => (
          a.pct > 0.1 && (
            <div
              key={i}
              style={{
                height: '100%',
                width: `${a.pct}%`,
                background: a.color,
                transition: 'width 0.4s ease',
                flexShrink: 0,
              }}
              title={`${a.name}: ${a.pct.toFixed(1)}%`}
            />
          )
        ))}
      </div>

      {/* Legend rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {normalised
          .filter(a => a.pct > 0.5)
          .sort((a, b) => b.pct - a.pct)
          .map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Color swatch */}
              <div style={{
                width: 10, height: 10, borderRadius: '2px',
                background: a.color, flexShrink: 0,
              }} />
              {/* Action name */}
              <span style={{
                flex: 1, fontSize: '12px',
                color: 'var(--text-secondary)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {a.name}
              </span>
              {/* Mini bar */}
              <div style={{
                width: 80, height: 5, background: 'var(--bg-base)',
                borderRadius: '2px', overflow: 'hidden', flexShrink: 0,
              }}>
                <div style={{
                  height: '100%',
                  width: `${a.pct}%`,
                  background: a.color,
                  transition: 'width 0.4s ease',
                }} />
              </div>
              {/* Percentage */}
              <span style={{
                fontSize: '12px', fontWeight: 700, fontFamily: 'monospace',
                color: a.color, minWidth: '38px', textAlign: 'right',
              }}>
                {a.pct.toFixed(1)}%
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
