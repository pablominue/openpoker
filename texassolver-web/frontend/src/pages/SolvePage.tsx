import { useState, useEffect, useRef } from 'react';
import { submitSolve, getJobStatus, createProgressSocket } from '../api/client';
import type { BetSizeConfig, JobStatus, SolveRequest } from '../types/solver';
import type { Card } from '../lib/poker';
import { boardToSolverNotation } from '../lib/poker';
import RangeEditor from '../components/RangeEditor';
import BoardSelector from '../components/BoardSelector';
import BetTreeBuilder from '../components/BetTreeBuilder';
import StrategyViewer from '../components/StrategyViewer';
import ExploitabilityChart from '../components/ExploitabilityChart';

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_RANGE_IP =
  'AA,KK,QQ,JJ,TT,99:0.75,88:0.75,77:0.5,AK,AQs,AQo:0.75,AJs,AJo:0.5,ATs:0.75,A5s:0.75,A4s:0.75,A3s:0.5,A2s:0.5,KQs,KQo:0.5,KJs,KTs:0.75,QJs:0.75,QTs:0.75,JTs:0.75,J9s:0.75,T9s:0.75,T8s:0.75,98s:0.75,87s:0.75,76s:0.75,65s:0.75,54s:0.75';

const DEFAULT_RANGE_OOP =
  'QQ:0.5,JJ:0.75,TT,99,88,77,66,55,44,33,22,AQs,AQo:0.75,AJs,AJo:0.75,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,KQ,KJ,KTs,K9s,K8s,QJ,QTs,Q9s,JTs,J9s,T9s,T8s,98s,97s,87s,76s,65s,54s';

const DEFAULT_BET_SIZES: BetSizeConfig[] = [
  { position: 'oop', street: 'flop',  action: 'bet',   sizes: [50] },
  { position: 'oop', street: 'flop',  action: 'raise',  sizes: [60] },
  { position: 'oop', street: 'flop',  action: 'allin',  sizes: [] },
  { position: 'ip',  street: 'flop',  action: 'bet',   sizes: [50] },
  { position: 'ip',  street: 'flop',  action: 'raise',  sizes: [60] },
  { position: 'ip',  street: 'flop',  action: 'allin',  sizes: [] },
  { position: 'oop', street: 'turn',  action: 'bet',   sizes: [50] },
  { position: 'oop', street: 'turn',  action: 'raise',  sizes: [60] },
  { position: 'oop', street: 'turn',  action: 'allin',  sizes: [] },
  { position: 'ip',  street: 'turn',  action: 'bet',   sizes: [50] },
  { position: 'ip',  street: 'turn',  action: 'raise',  sizes: [60] },
  { position: 'ip',  street: 'turn',  action: 'allin',  sizes: [] },
  { position: 'oop', street: 'river', action: 'bet',   sizes: [50] },
  { position: 'oop', street: 'river', action: 'raise',  sizes: [60, 100] },
  { position: 'oop', street: 'river', action: 'allin',  sizes: [] },
  { position: 'ip',  street: 'river', action: 'bet',   sizes: [50] },
  { position: 'ip',  street: 'river', action: 'raise',  sizes: [60, 100] },
  { position: 'ip',  street: 'river', action: 'allin',  sizes: [] },
];

// ─── Section wrapper ──────────────────────────────────────────────────────────

type SectionId = 'board' | 'ranges' | 'betsizes' | 'settings' | 'results';

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'board',    label: 'Board',     icon: '♠' },
  { id: 'ranges',   label: 'Ranges',    icon: '⊞' },
  { id: 'betsizes', label: 'Bet Sizes', icon: '⟰' },
  { id: 'settings', label: 'Settings',  icon: '⚙' },
  { id: 'results',  label: 'Results',   icon: '◉' },
];

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  pending: '#d29922',
  running: '#388bfd',
  done:    '#10b981',
  failed:  '#f85149',
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SolvePage() {
  // Form state
  const [pot, setPot] = useState(50);
  const [stack, setStack] = useState(200);
  const [boardCards, setBoardCards] = useState<Card[]>([]);
  const [rangeIp, setRangeIp] = useState(DEFAULT_RANGE_IP);
  const [rangeOop, setRangeOop] = useState(DEFAULT_RANGE_OOP);
  const [betSizes, setBetSizes] = useState<BetSizeConfig[]>(DEFAULT_BET_SIZES);
  const [threads, setThreads] = useState(4);
  const [accuracy, setAccuracy] = useState(0.5);
  const [maxIter, setMaxIter] = useState(200);
  const [allinThreshold, setAllinThreshold] = useState(0.67);

  // UI state
  const [activeSection, setActiveSection] = useState<SectionId>('board');

  // Job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const logRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progress]);

  // WebSocket progress stream
  useEffect(() => {
    if (!jobId || status === 'done' || status === 'failed') return;
    const ws = createProgressSocket(jobId);
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.line) setProgress(p => [...p, msg.line]);
      if (msg.status === 'done' || msg.status === 'failed') {
        setStatus(msg.status);
        if (msg.error) setError(msg.error);
        ws.close();
      }
    };
    ws.onerror = () => ws.close();
    return () => ws.close();
  }, [jobId, status]);

  // Polling fallback
  useEffect(() => {
    if (!jobId || status === 'done' || status === 'failed') return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const iv = setInterval(async () => {
      try {
        const res = await getJobStatus(jobId);
        setStatus(res.status);
        setProgress(res.progress);
        if (res.status === 'done' || res.status === 'failed') {
          setError(res.error);
          clearInterval(iv);
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(iv);
  }, [jobId, status]);

  const handleSubmit = async () => {
    if (boardCards.length < 3) { alert('Select at least 3 board cards (flop).'); return; }
    setSubmitting(true);
    setJobId(null);
    setStatus(null);
    setProgress([]);
    setError(null);

    const req: SolveRequest = {
      pot,
      effective_stack: stack,
      board: boardToSolverNotation(boardCards),
      range_ip: rangeIp,
      range_oop: rangeOop,
      bet_sizes: betSizes,
      allin_threshold: allinThreshold,
      thread_num: threads,
      accuracy,
      max_iteration: maxIter,
    };

    try {
      const res = await submitSolve(req);
      setJobId(res.job_id);
      setStatus('pending');
      setActiveSection('results');
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isSolving = status === 'running' || status === 'pending';
  const boardStr = boardToSolverNotation(boardCards);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

      {/* ── Top nav tabs ── */}
      <nav style={{ display: 'flex', gap: '4px', overflowX: 'auto' }}>
        {SECTIONS.map(s => {
          const isActive = activeSection === s.id;
          const hasBadge = s.id === 'results' && jobId;
          return (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px',
                borderRadius: '8px',
                border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                background: isActive ? 'var(--accent-dim)' : 'var(--bg-surface)',
                color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
                fontWeight: isActive ? 700 : 500,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
                position: 'relative',
              }}
            >
              <span style={{ fontSize: '14px' }}>{s.icon}</span>
              {s.label}
              {hasBadge && status && (
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: STATUS_COLORS[status] || '#888',
                  display: 'inline-block',
                  animation: isSolving ? 'pulse 1.5s infinite' : 'none',
                }} />
              )}
            </button>
          );
        })}
      </nav>

      {/* ── Board & Game Parameters ── */}
      {activeSection === 'board' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <Card title="Board" subtitle="Select 3–5 cards">
            <BoardSelector value={boardCards} onChange={setBoardCards} />
          </Card>

          <Card title="Game Parameters" subtitle="Pot and stack sizes">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <Field label="Pot (chips)">
                <NumInput value={pot} onChange={setPot} min={1} />
              </Field>
              <Field label="Effective Stack (chips)">
                <NumInput value={stack} onChange={setStack} min={1} />
              </Field>
            </div>
          </Card>
        </div>
      )}

      {/* ── Ranges ── */}
      {activeSection === 'ranges' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <Card title="IP Range" subtitle="In Position">
            <RangeEditor label="IP" value={rangeIp} onChange={setRangeIp} />
          </Card>
          <Card title="OOP Range" subtitle="Out of Position">
            <RangeEditor label="OOP" value={rangeOop} onChange={setRangeOop} />
          </Card>
        </div>
      )}

      {/* ── Bet Sizes ── */}
      {activeSection === 'betsizes' && (
        <Card title="Bet Tree" subtitle="Configure bet and raise sizes per street">
          <BetTreeBuilder value={betSizes} onChange={setBetSizes} />
        </Card>
      )}

      {/* ── Settings ── */}
      {activeSection === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Card title="Solver Settings">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              <Field label="Threads" hint="CPU threads to use">
                <NumInput value={threads} onChange={setThreads} min={1} max={32} />
              </Field>
              <Field label="Accuracy (chips)" hint="Target exploitability">
                <NumInput value={accuracy} onChange={setAccuracy} min={0.01} step={0.01} />
              </Field>
              <Field label="Max Iterations">
                <NumInput value={maxIter} onChange={setMaxIter} min={1} />
              </Field>
              <Field label="All-in Threshold" hint="SPR below which all-in is offered">
                <NumInput value={allinThreshold} onChange={setAllinThreshold} min={0} max={1} step={0.01} />
              </Field>
            </div>
          </Card>

          {/* Summary */}
          <Card title="Solve Summary">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
              <Row label="Board" value={boardStr || <span style={{ color: 'var(--danger)' }}>Not set</span>} mono />
              <Row label="Pot" value={`${pot} chips`} />
              <Row label="Stack" value={`${stack} chips`} />
              <Row label="IP combos" value={`${rangeIp.split(',').length} hands`} />
              <Row label="OOP combos" value={`${rangeOop.split(',').length} hands`} />
              <Row label="Bet configs" value={`${betSizes.length} entries`} />
            </div>
          </Card>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || isSolving || boardCards.length < 3}
            style={{
              padding: '14px 24px',
              borderRadius: '12px',
              border: 'none',
              background: (submitting || isSolving || boardCards.length < 3) ? 'var(--bg-elevated)' : 'var(--accent)',
              color: (submitting || isSolving || boardCards.length < 3) ? 'var(--text-muted)' : 'var(--bg-base)',
              fontSize: '15px',
              fontWeight: 800,
              cursor: (submitting || isSolving || boardCards.length < 3) ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s',
              letterSpacing: '0.02em',
              boxShadow: 'none',
            }}
            onMouseEnter={e => {
              if (!submitting && !isSolving && boardCards.length >= 3)
                e.currentTarget.style.filter = 'brightness(1.1)';
            }}
            onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
          >
            {submitting ? '⏳ Submitting…' : isSolving ? '⚡ Solving in progress…' : '▶ Run Solver'}
          </button>
          {boardCards.length < 3 && (
            <p style={{ fontSize: '12px', color: 'var(--warning)', margin: 0 }}>
              ⚠ Select at least 3 board cards before solving.
            </p>
          )}
        </div>
      )}

      {/* ── Results ── */}
      {activeSection === 'results' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {!jobId ? (
            <Card title="No results yet">
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '13px' }}>
                Configure your solve in the Settings tab and click Run Solver.
              </p>
            </Card>
          ) : (
            <>
              {/* ── Status row ── */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                gap: '16px', flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: status ? STATUS_COLORS[status] : '#888',
                    flexShrink: 0,
                    boxShadow: isSolving ? `0 0 8px ${STATUS_COLORS[status ?? 'pending']}` : 'none',
                    animation: isSolving ? 'pulse 1.5s infinite' : 'none',
                  }} />
                  <span style={{
                    fontSize: '14px', fontWeight: 800,
                    color: status ? STATUS_COLORS[status] : 'var(--text-secondary)',
                    textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>
                    {status ?? 'Unknown'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                    {jobId.slice(0, 8)}…
                  </span>
                </div>
                {status === 'done' && (
                  <a
                    href={`/api/jobs/${jobId}/result`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '7px 14px', borderRadius: '8px',
                      background: 'var(--accent-dim)', border: '1px solid var(--accent)',
                      color: 'var(--accent-text)', fontWeight: 700, fontSize: '12px',
                      textDecoration: 'none', transition: 'filter 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.15)')}
                    onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
                  >
                    ↓ Download JSON
                  </a>
                )}
              </div>

              {error && (
                <div style={{
                  padding: '12px 16px', borderRadius: '10px',
                  background: 'rgba(248,81,73,0.08)', border: '1px solid var(--danger)',
                  color: 'var(--danger)', fontSize: '13px',
                }}>
                  {error}
                </div>
              )}

              {/* ── Exploitability chart (shows while solving and after) ── */}
              {progress.length > 0 && (
                <Card title="Convergence" subtitle="Exploitability % over iterations">
                  <ExploitabilityChart progressLines={progress} targetAccuracy={accuracy} />
                </Card>
              )}

              {/* ── Live log (collapsible, shown while solving) ── */}
              {isSolving && (
                <Card title="Solver Output">
                  <div
                    ref={logRef}
                    style={{
                      background: 'var(--bg-base)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      height: '200px',
                      overflowY: 'auto',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.65',
                    }}
                  >
                    {progress.length === 0 ? (
                      <span style={{ color: 'var(--text-muted)' }}>Waiting for solver output…</span>
                    ) : (
                      progress.map((line, i) => {
                        const isHighlight = /iter|exploitability|precent/i.test(line);
                        return (
                          <div key={i} style={{ color: isHighlight ? 'var(--accent-text)' : 'var(--text-secondary)' }}>
                            {line}
                          </div>
                        );
                      })
                    )}
                  </div>
                </Card>
              )}

              {/* ── Strategy viewer (only when solve is complete) ── */}
              {status === 'done' && (
                <Card title="Strategy Explorer" subtitle="Navigate the GTO bet tree · hover hands for exact frequencies">
                  <StrategyViewer jobId={jobId} />
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}

// ─── Reusable sub-components ─────────────────────────────────────────────────

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: '14px',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 20px 14px',
        borderBottom: '1px solid var(--border-subtle)',
      }}>
        <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{subtitle}</div>}
      </div>
      <div style={{ padding: '20px' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div>
        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
        {hint && <div style={{ fontSize: '10px', color: 'var(--text-muted)', opacity: 0.7 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function NumInput({ value, onChange, min, max, step }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type="number" min={min} max={max} step={step ?? 1} value={value}
      onChange={e => onChange(Number(e.target.value))}
      style={{
        width: '100%', boxSizing: 'border-box',
        background: 'var(--bg-base)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '8px 10px',
        color: 'var(--text-primary)', fontSize: '14px',
        outline: 'none', fontWeight: 500,
      }}
      onFocus={e => (e.target.style.borderColor = 'var(--accent)')}
      onBlur={e => (e.target.style.borderColor = 'var(--border)')}
    />
  );
}

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>{label}</span>
      <span style={{ color: 'var(--text-primary)', fontSize: '12px', fontFamily: mono ? 'monospace' : 'inherit', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
