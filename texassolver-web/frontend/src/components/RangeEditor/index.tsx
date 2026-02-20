import { useCallback, useEffect, useRef, useState } from 'react';
import { RANKS, cellName, emptyMatrix, freqStyle, parseRange, serializeRange, type RangeMatrix } from '../../lib/poker';

interface Props {
  label: string;
  value: string;
  onChange: (range: string) => void;
}

type PaintMode = 'set' | 'clear' | null;

const COMBOS: Record<string, number> = {};
for (let r = 0; r < 13; r++) {
  for (let c = 0; c < 13; c++) {
    COMBOS[cellName(r, c)] = r === c ? 6 : 16; // pairs=6 combos, others=16 (suited or offsuit each have 4*4 minus same suits etc — simplified)
  }
}

function totalCombos(mat: RangeMatrix): { weighted: number; total: number } {
  let weighted = 0, total = 0;
  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const base = r === c ? 6 : (r < c ? 4 : 12); // pairs=6, suited=4, offsuit=12
      total += base;
      weighted += base * mat[r][c];
    }
  }
  return { weighted, total };
}

export default function RangeEditor({ label, value, onChange }: Props) {
  const [mat, setMat] = useState<RangeMatrix>(() => parseRange(value));
  const [textDraft, setTextDraft] = useState(value);
  const [hovered, setHovered] = useState<string | null>(null);
  const [freqModal, setFreqModal] = useState<{ r: number; c: number } | null>(null);
  const [customFreq, setCustomFreq] = useState('');
  const paintMode = useRef<PaintMode>(null);
  const isPainting = useRef(false);

  // Sync incoming value → matrix (when parent resets)
  useEffect(() => {
    const newMat = parseRange(value);
    setMat(newMat);
    setTextDraft(value);
  }, [value]);

  const emit = useCallback((newMat: RangeMatrix) => {
    const str = serializeRange(newMat);
    setTextDraft(str);
    onChange(str);
  }, [onChange]);

  const toggleCell = (r: number, c: number, mode: PaintMode) => {
    setMat(prev => {
      const next = prev.map(row => [...row]);
      if (mode === 'set') next[r][c] = 1;
      else if (mode === 'clear') next[r][c] = 0;
      else next[r][c] = next[r][c] > 0 ? 0 : 1;
      emit(next);
      return next;
    });
  };

  const handleMouseDown = (r: number, c: number, e: React.MouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      setFreqModal({ r, c });
      setCustomFreq(String(mat[r][c]));
      return;
    }
    isPainting.current = true;
    const newMode: PaintMode = mat[r][c] > 0 ? 'clear' : 'set';
    paintMode.current = newMode;
    toggleCell(r, c, newMode);
  };

  const handleMouseEnter = (r: number, c: number) => {
    setHovered(cellName(r, c));
    if (isPainting.current) toggleCell(r, c, paintMode.current);
  };

  useEffect(() => {
    const up = () => { isPainting.current = false; paintMode.current = null; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const handleTextChange = (raw: string) => {
    setTextDraft(raw);
    const parsed = parseRange(raw);
    setMat(parsed);
    onChange(raw);
  };

  const handleSelectAll = () => {
    const full = emptyMatrix().map(row => row.map(() => 1));
    emit(full);
    setMat(full);
  };

  const handleClear = () => {
    const empty = emptyMatrix();
    emit(empty);
    setMat(empty);
  };

  const applyCustomFreq = () => {
    if (!freqModal) return;
    const f = Math.min(1, Math.max(0, parseFloat(customFreq) || 0));
    setMat(prev => {
      const next = prev.map(row => [...row]);
      next[freqModal.r][freqModal.c] = f;
      emit(next);
      return next;
    });
    setFreqModal(null);
  };

  const { weighted, total } = totalCombos(mat);
  const pct = total > 0 ? ((weighted / total) * 100).toFixed(1) : '0.0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} onContextMenu={e => e.preventDefault()}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>{label}</span>
          <span style={{
            padding: '2px 8px', borderRadius: '999px',
            background: 'var(--accent-dim)', color: 'var(--accent-text)',
            fontSize: '11px', fontWeight: 600,
          }}>
            {pct}% · {weighted.toFixed(0)} combos
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={handleSelectAll} style={smallBtn}>All</button>
          <button onClick={handleClear} style={smallBtn}>Clear</button>
        </div>
      </div>

      {/* Matrix */}
      <div style={{ position: 'relative' }}>
        {/* Rank labels row */}
        <div style={{ display: 'grid', gridTemplateColumns: '14px repeat(13, 1fr)', gap: '2px', marginBottom: '2px' }}>
          <div />
          {RANKS.map(r => (
            <div key={r} style={{ textAlign: 'center', fontSize: '9px', color: 'var(--text-muted)', fontWeight: 700 }}>{r}</div>
          ))}
        </div>

        {RANKS.map((rowRank, r) => (
          <div key={rowRank} style={{ display: 'grid', gridTemplateColumns: '14px repeat(13, 1fr)', gap: '2px', marginBottom: '2px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: 'var(--text-muted)', fontWeight: 700 }}>{rowRank}</div>
            {RANKS.map((_colRank, c) => {
              const name = cellName(r, c);
              const freq = mat[r][c];
              const isHov = hovered === name;
              return (
                <div
                  key={c}
                  className={`range-cell${freq > 0 ? ' active' : ''}`}
                  style={{
                    ...freqStyle(freq),
                    outline: isHov ? '2px solid var(--accent)' : undefined,
                    zIndex: isHov ? 3 : undefined,
                  }}
                  title={`${name} (${(freq * 100).toFixed(0)}%)\nRight-click to set partial frequency`}
                  onMouseDown={e => handleMouseDown(r, c, e)}
                  onMouseEnter={() => handleMouseEnter(r, c)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span style={{ fontSize: '9px', lineHeight: 1, pointerEvents: 'none' }}>{name}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Hovered hand label */}
      <div style={{ height: '16px', fontSize: '11px', color: 'var(--text-secondary)' }}>
        {hovered && (() => {
          const parts = hovered.match(/^([AKQJT2-9])([AKQJT2-9])(s|o)?$/);
          if (!parts) return null;
          const pos = RANKS.indexOf(parts[1] as typeof RANKS[number]);
          const pos2 = RANKS.indexOf(parts[2] as typeof RANKS[number]);
          const r2 = pos, c2 = parts[3] === 'o' ? pos : (parts[3] === 's' ? Math.max(pos, pos2) : pos2);
          const r3 = parts[3] === 'o' ? Math.max(pos, pos2) : pos;
          const c3 = parts[3] === 'o' ? pos : (parts[3] === 's' ? pos2 : pos);
          const freq = mat[Math.min(r2,r3)][Math.min(c2,c3)] || mat[Math.max(r2,r3)][Math.max(c2,c3)] || 0;
          return <span><strong style={{ color: 'var(--text-primary)' }}>{hovered}</strong> — {(freq * 100).toFixed(0)}% frequency</span>;
        })()}
      </div>

      {/* Text textarea */}
      <div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Range string
        </div>
        <textarea
          value={textDraft}
          onChange={e => handleTextChange(e.target.value)}
          rows={3}
          style={{
            width: '100%',
            background: 'var(--bg-base)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '8px 10px',
            color: 'var(--text-primary)',
            fontSize: '11px',
            fontFamily: 'monospace',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
          onBlur={e => (e.target.style.borderColor = 'var(--border)')}
          placeholder="e.g. AA,KK,AKs,AKo:0.75,..."
        />
      </div>

      {/* Custom frequency modal */}
      {freqModal && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', zIndex: 200,
        }} onClick={() => setFreqModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: '12px', padding: '20px', width: '220px',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{ fontWeight: 700, marginBottom: '4px', color: 'var(--text-primary)' }}>
              {cellName(freqModal.r, freqModal.c)}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              Set partial frequency (0 – 1)
            </div>
            <input
              type="number" min={0} max={1} step={0.05}
              value={customFreq}
              onChange={e => setCustomFreq(e.target.value)}
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-base)', border: '1px solid var(--accent)',
                borderRadius: '6px', padding: '6px 8px',
                color: 'var(--text-primary)', fontSize: '13px', outline: 'none',
              }}
              onKeyDown={e => { if (e.key === 'Enter') applyCustomFreq(); if (e.key === 'Escape') setFreqModal(null); }}
            />
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button onClick={applyCustomFreq} style={{ ...smallBtn, flex: 1, background: 'var(--accent)', color: 'var(--bg-base)', border: 'none' }}>Apply</button>
              <button onClick={() => setFreqModal(null)} style={{ ...smallBtn, flex: 1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 600,
  transition: 'all 0.12s',
};
