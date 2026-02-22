import type { SolverNode } from '../../types/solver';
import { actionColor } from '../../lib/strategyUtils';

interface Props {
  actionName: string;
  gtoFreq: number;       // 0–1 range-wide frequency
  comboCount: number;
  onClick: () => void;
  child: SolverNode;
}

export default function GtoActionPanel({ actionName, gtoFreq, comboCount, onClick }: Props) {
  const color = actionColor(actionName);
  const pct = Math.round(gtoFreq * 100);

  return (
    <button
      onClick={onClick}
      style={{
        flex: '1 1 140px',
        minWidth: 120,
        padding: '16px 14px',
        borderRadius: '12px',
        border: `1.5px solid ${color}60`,
        background: `${color}12`,
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        position: 'relative',
        overflow: 'hidden',
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = `${color}22`;
        e.currentTarget.style.borderColor = color;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = `${color}12`;
        e.currentTarget.style.borderColor = `${color}60`;
      }}
    >
      {/* Background fill proportional to frequency */}
      <div style={{
        position: 'absolute', left: 0, bottom: 0,
        width: `${pct}%`, height: '4px',
        background: color,
        borderRadius: '0 2px 0 0',
        transition: 'width 0.4s ease',
      }} />

      {/* Action name */}
      <div style={{ fontSize: '11px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {actionName}
      </div>

      {/* Frequency — big number */}
      <div style={{ fontSize: '36px', fontWeight: 900, color, lineHeight: 1 }}>
        {pct}<span style={{ fontSize: '16px', fontWeight: 500 }}>%</span>
      </div>

      {/* Combo count */}
      <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
        {comboCount} combos
      </div>
    </button>
  );
}
