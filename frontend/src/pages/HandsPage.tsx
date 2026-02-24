import { useState, useRef, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { uploadHands, getHands, deleteHand, getHandGTOAnalysis } from '../api/hands';
import type { GTOAnalysisResult, GTODecision } from '../api/hands';
import { usePlayer } from '../contexts/PlayerContext';
import HandStrategyMatrix from '../components/StrategyViewer/HandStrategyMatrix';
import ActionBreakdown from '../components/StrategyViewer/ActionBreakdown';
import { actionColor } from '../lib/strategyUtils';
import type { ActionEntry } from '../types/solver';

interface Hand {
  id: string; hand_id_raw: string; played_at: string; stakes_bb: number;
  table_name: string; hero_position: string | null; hero_hole_cards: string | null;
  board: string | null; hero_result: number; hero_won: boolean; vpip: boolean; pfr: boolean;
}

interface UploadStats { parsed: number; skipped: number; duplicate: number; }

interface HandFilters {
  position?: string;
  three_bet_pot?: boolean;
  date_from?: string;
  date_to?: string;
}

function bbDisplay(cents: number, bb: number): string {
  if (bb === 0) return `${(cents / 100).toFixed(2)}€`;
  const bbs = cents / bb;
  return `${bbs >= 0 ? '+' : ''}${bbs.toFixed(1)}bb`;
}

const POSITIONS = ['BTN', 'CO', 'HJ', 'SB', 'BB', 'EP'];
const SUIT_SYMBOLS: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };
const SUIT_COLORS: Record<string, string> = { h: '#e53935', d: '#e53935', c: '#1a1a1a', s: '#1a1a1a' };

function CardBadge({ card }: { card: string }) {
  if (card.length !== 2) return <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>{card}</span>;
  const rank = card[0];
  const suit = card[1];
  const sym = SUIT_SYMBOLS[suit] ?? suit;
  const color = SUIT_COLORS[suit] ?? 'var(--text-primary)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '1px',
      background: '#f5f5f5', border: '1px solid rgba(0,0,0,0.15)',
      borderRadius: '4px', padding: '1px 4px', fontSize: '11px', fontWeight: 700,
      color: '#1a1a1a',
    }}>
      {rank}<span style={{ color, fontSize: '9px' }}>{sym}</span>
    </span>
  );
}

function CardsDisplay({ cards }: { cards: string }) {
  const pairs = cards.match(/.{2}/g) ?? [];
  return (
    <span style={{ display: 'inline-flex', gap: '2px' }}>
      {pairs.map((c, i) => <CardBadge key={i} card={c} />)}
    </span>
  );
}

// ── GTO helpers ────────────────────────────────────────────────────────────────

/**
 * All trainer spots use ×10 chip scaling (pot=70 chips = 7bb, etc.).
 * This converts raw solver action names to BB display labels.
 * e.g. "BET 35.000000" → "BET 3.5bb"  |  "CHECK" → "CHECK"
 */
function fmtAction(name: string): string {
  return name.replace(/([\d]+\.?[\d]*)/g, (_, n) => {
    const chips = parseFloat(n);
    const bb = chips / 10;
    const bbStr = Number.isInteger(bb) ? String(bb) : bb.toFixed(1).replace(/\.0$/, '');
    return `${bbStr}bb`;
  });
}

// ── GTO Grade badge ────────────────────────────────────────────────────────────

const GRADE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  best:       { label: 'Best',       color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  correct:    { label: 'Correct',    color: 'var(--info)', bg: 'rgba(59,130,246,0.12)' },
  inaccuracy: { label: 'Inaccuracy', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  wrong:      { label: 'Wrong',      color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  blunder:    { label: 'Blunder',    color: 'var(--danger)', bg: 'rgba(248,81,73,0.12)' },
};

function GradeBadge({ grade }: { grade: string }) {
  const cfg = GRADE_CONFIG[grade] ?? { label: grade, color: 'var(--text-muted)', bg: 'var(--bg-surface)' };
  return (
    <span style={{
      padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700,
      background: cfg.bg, color: cfg.color, letterSpacing: '0.02em',
    }}>
      {cfg.label}
    </span>
  );
}

// ── GTO Action frequency bar ───────────────────────────────────────────────────

function ActionBar({ actions, chosen }: {
  actions: Array<{ name: string; gto_freq: number }>;
  chosen: string | null;
}) {
  const total = actions.reduce((s, a) => s + a.gto_freq, 0) || 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {actions.map(a => {
        const pct = Math.round(a.gto_freq / total * 100);
        const isChosen = a.name === chosen;
        return (
          <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: 80, fontSize: '11px', fontWeight: isChosen ? 700 : 400,
              color: isChosen ? 'var(--accent-text)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {fmtAction(a.name)}
            </span>
            <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-hover)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4, width: `${pct}%`,
                background: isChosen ? 'var(--accent)' : 'var(--border)',
                transition: 'width 0.3s',
              }} />
            </div>
            <span style={{ width: 32, fontSize: '11px', textAlign: 'right', color: 'var(--text-muted)' }}>
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── GTO Analysis Modal ─────────────────────────────────────────────────────────

function GTOModal({ hand, playerName, onClose }: { hand: Hand; playerName: string; onClose: () => void }) {
  const [analysis, setAnalysis] = useState<GTOAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHandGTOAnalysis(hand.id, playerName)
      .then(r => { setAnalysis(r); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const streetLabel: Record<string, string> = { flop: 'Flop', turn: 'Turn', river: 'River' };
  const verbLabel: Record<string, string> = {
    checks: 'Check', bets: 'Bet', calls: 'Call', folds: 'Fold', raises: 'Raise',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '14px',
          maxWidth: 900, width: '100%', maxHeight: '90vh', overflow: 'auto',
          padding: '24px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
              GTO Analysis
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {hand.hero_position && <span style={{ fontWeight: 700, color: 'var(--accent-text)' }}>{hand.hero_position}</span>}
              {hand.hero_hole_cards && <CardsDisplay cards={hand.hero_hole_cards} />}
              {hand.board && <><span style={{ color: 'var(--border)' }}>|</span><CardsDisplay cards={hand.board} /></>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px', padding: '0 4px' }}>✕</button>
        </div>

        {loading && <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '13px' }}>Analyzing…</div>}
        {error && <div style={{ padding: '12px', borderRadius: '8px', background: 'rgba(248,81,73,0.08)', color: 'var(--danger)', fontSize: '12px' }}>{error}</div>}

        {analysis && (
          <>
            {/* Spot label */}
            {analysis.matched_spot_label && (
              <div style={{
                padding: '8px 12px', borderRadius: '8px', marginBottom: '16px',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                fontSize: '11px', color: 'var(--text-secondary)',
              }}>
                <span style={{ fontWeight: 700, color: 'var(--accent-text)' }}>Spot: </span>
                {analysis.matched_spot_label}
                {analysis.note && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>— {analysis.note}</span>}
              </div>
            )}

            {/* No decisions */}
            {analysis.decisions.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
                {analysis.note ?? 'No GTO decisions found for this hand.'}
              </div>
            )}

            {/* Decision cards */}
            {analysis.decisions.map((d: GTODecision, i: number) => {
              const entries: ActionEntry[] = d.action_entries;
              const hasMatrix = d.range_strategy && entries.length > 0;

              // Build aggregates for ActionBreakdown directly from range_strategy
              const aggregates = hasMatrix ? (() => {
                const strategy = d.range_strategy!;
                const sums = new Array(entries.length).fill(0);
                let total = 0;
                for (const freqs of Object.values(strategy)) {
                  if (freqs.length !== entries.length) continue;
                  freqs.forEach((f, idx) => { sums[idx] += f; });
                  total++;
                }
                return entries.map((e, idx) => ({
                  name: fmtAction(e.name),
                  color: actionColor(e.name),
                  freq: total > 0 ? sums[idx] / total : 0,
                  index: e.index,
                }));
              })() : [];

              return (
                <div key={i} style={{
                  marginBottom: '16px', padding: '16px', borderRadius: '12px',
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                }}>
                  {/* Decision header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {streetLabel[d.street] ?? d.street}
                      </span>
                      <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {verbLabel[d.hero_action] ?? d.hero_action}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        GTO freq: <span style={{ fontWeight: 700, color: d.hero_gto_freq >= 0.75 ? '#22c55e' : d.hero_gto_freq >= 0.40 ? 'var(--info)' : 'var(--danger)' }}>
                          {Math.round(d.hero_gto_freq * 100)}%
                        </span>
                      </span>
                      <GradeBadge grade={d.grade} />
                    </div>
                  </div>

                  {hasMatrix ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: '16px', alignItems: 'start' }}>
                      {/* Left: range matrix */}
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                          Range strategy
                        </div>
                        <HandStrategyMatrix
                          strategy={d.range_strategy!}
                          entries={entries}
                          highlightCombo={analysis.hero_combo ?? undefined}
                        />
                      </div>

                      {/* Right: action breakdown + hero combo detail */}
                      <div>
                        <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                          Action frequencies
                        </div>
                        <ActionBreakdown aggregates={aggregates} />

                        {/* Hero combo GTO breakdown */}
                        {analysis.hero_combo && (
                          <div style={{ marginTop: '16px' }}>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                              Your hand ({analysis.hero_combo})
                            </div>
                            {(() => {
                              const comboFreqs = d.range_strategy![analysis.hero_combo!];
                              if (!comboFreqs) return (
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>Combo not in range</div>
                              );
                              return entries.map((e, idx) => {
                                const freq = comboFreqs[e.index] ?? 0;
                                if (freq < 0.001) return null;
                                const isChosen = e.name === d.matched_solver_action;
                                return (
                                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px' }}>
                                    <div style={{ width: 8, height: 8, borderRadius: '2px', background: actionColor(e.name), flexShrink: 0 }} />
                                    <span style={{ flex: 1, fontSize: '12px', color: isChosen ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isChosen ? 700 : 400 }}>
                                      {fmtAction(e.name)}{isChosen ? ' ✓' : ''}
                                    </span>
                                    <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: actionColor(e.name), minWidth: '38px', textAlign: 'right' }}>
                                      {(freq * 100).toFixed(1)}%
                                    </span>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* Fallback: simple action bar if no range data */
                    <ActionBar actions={d.gto_actions} chosen={d.matched_solver_action} />
                  )}
                </div>
              );
            })}

            {/* Summary score */}
            {analysis.decisions.length > 0 && (
              <div style={{
                marginTop: '4px', padding: '12px', borderRadius: '8px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {analysis.decisions.length} decision{analysis.decisions.length !== 1 ? 's' : ''} analyzed
                </span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-text)' }}>
                  Avg GTO: {Math.round(analysis.decisions.reduce((s, d) => s + d.hero_gto_freq, 0) / analysis.decisions.length * 100)}%
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Filter panel for hands ─────────────────────────────────────────────────────

function HandsFilterPanel({ filters, onChange }: { filters: HandFilters; onChange: (f: HandFilters) => void }) {
  const hasFilters = !!(filters.position || filters.three_bet_pot || filters.date_from || filters.date_to);
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center',
      padding: '12px 16px', borderRadius: '10px',
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      marginBottom: '16px',
    }}>
      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Filter
      </span>
      <select
        value={filters.position ?? ''}
        onChange={e => onChange({ ...filters, position: e.target.value || undefined })}
        style={selectStyle}
      >
        <option value="">All positions</option>
        {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--text-secondary)' }}>
        <input
          type="checkbox"
          checked={!!filters.three_bet_pot}
          onChange={e => onChange({ ...filters, three_bet_pot: e.target.checked || undefined })}
          style={{ accentColor: 'var(--accent)', width: 13, height: 13 }}
        />
        3-bet pots
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>From</span>
        <input type="date" value={filters.date_from ?? ''} onChange={e => onChange({ ...filters, date_from: e.target.value || undefined })} style={inputStyle} />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>To</span>
        <input type="date" value={filters.date_to ?? ''} onChange={e => onChange({ ...filters, date_to: e.target.value || undefined })} style={inputStyle} />
      </div>
      {hasFilters && (
        <button onClick={() => onChange({})} style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '11px' }}>
          Clear
        </button>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function HandsPage() {
  const { selectedPlayer, refreshPlayers } = usePlayer();
  const [hands, setHands] = useState<Hand[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [filters, setFilters] = useState<HandFilters>({});
  const [gtoHand, setGtoHand] = useState<Hand | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const PER_PAGE = 50;

  const load = async (p = page, f = filters) => {
    if (!selectedPlayer) return;
    setLoading(true);
    try {
      const data = await getHands(selectedPlayer, p, PER_PAGE, f);
      setHands(data.hands);
      setTotal(data.total);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (f: HandFilters) => {
    setFilters(f);
    setPage(1);
    load(1, f);
  };

  const handleFiles = async (files: File[]) => {
    const txtFiles = files.filter(f => f.name.endsWith('.txt'));
    if (txtFiles.length === 0 || !selectedPlayer) return;

    setUploading(true);
    setUploadMsg(null);
    setUploadProgress({ done: 0, total: txtFiles.length });

    const totals: UploadStats = { parsed: 0, skipped: 0, duplicate: 0 };
    const errors: string[] = [];

    for (let i = 0; i < txtFiles.length; i++) {
      try {
        const res = await uploadHands(txtFiles[i], selectedPlayer);
        totals.parsed += res.parsed;
        totals.skipped += res.skipped;
        totals.duplicate += res.duplicate;
      } catch (err: unknown) {
        errors.push(`${txtFiles[i].name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      setUploadProgress({ done: i + 1, total: txtFiles.length });
    }

    await refreshPlayers();
    load(1, filters);
    setUploadProgress(null);
    setUploading(false);

    if (errors.length > 0) {
      setUploadMsg(`Errors in ${errors.length} file(s): ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}`);
    } else {
      const label = txtFiles.length > 1 ? `${txtFiles.length} files` : txtFiles[0].name;
      setUploadMsg(`${label} → ${totals.parsed} imported · ${totals.duplicate} duplicates · ${totals.skipped} skipped`);
    }

    if (fileRef.current) fileRef.current.value = '';
    if (folderRef.current) folderRef.current.value = '';
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFiles(Array.from(e.target.files ?? []));
  };

  const handleDelete = async (id: string) => {
    if (!selectedPlayer) return;
    await deleteHand(id, selectedPlayer);
    setHands(prev => prev.filter(h => h.id !== id));
    setTotal(prev => prev - 1);
  };

  if (!selectedPlayer) {
    return (
      <div style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>♠</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>Select a player to view hands</div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Use the player selector in the top-right to choose a player, or enter your PokerStars username to get started.
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '24px' }}>
        Hand History — <span style={{ color: 'var(--accent)' }}>{selectedPlayer}</span>
      </h1>

      {/* Upload area */}
      <div style={{ marginBottom: '20px', padding: '20px', borderRadius: '12px', border: '2px dashed var(--border)', background: 'var(--bg-surface)' }}>
        <input ref={fileRef} type="file" accept=".txt" multiple onChange={handleFileInput} style={{ display: 'none' }} />
        <input ref={folderRef} type="file"
          // @ts-expect-error webkitdirectory is non-standard
          webkitdirectory=""
          onChange={handleFileInput} style={{ display: 'none' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={() => fileRef.current?.click()} disabled={uploading} style={btnStyle(uploading)}>
            {uploading ? `Importing… (${uploadProgress?.done ?? 0}/${uploadProgress?.total ?? '?'})` : '↑ Upload .txt files'}
          </button>
          <button onClick={() => folderRef.current?.click()} disabled={uploading} style={{ ...btnStyle(uploading), background: 'var(--bg-elevated)' }}>
            📁 Upload folder
          </button>
          {!loaded && (
            <button onClick={() => load(1)} disabled={loading} style={{ padding: '9px 18px', borderRadius: '9px', border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent-text)', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
              {loading ? 'Loading…' : 'Load hands'}
            </button>
          )}
          {total > 0 && <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{total} hands total</span>}
        </div>

        {uploadProgress && (
          <div style={{ marginTop: '10px' }}>
            <div style={{ height: '4px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: '2px', background: 'var(--accent)', width: `${Math.round(uploadProgress.done / uploadProgress.total * 100)}%`, transition: 'width 0.2s' }} />
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{uploadProgress.done} / {uploadProgress.total} files processed</div>
          </div>
        )}
        {uploadMsg && (
          <div style={{ marginTop: '10px', fontSize: '12px', color: uploadMsg.startsWith('Error') ? 'var(--danger)' : 'var(--info)' }}>{uploadMsg}</div>
        )}
      </div>

      {/* Hands table */}
      {loaded && (
        <>
          {/* Filters */}
          <HandsFilterPanel filters={filters} onChange={handleFilterChange} />

          <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                  {['Date', 'Position', 'Hand', 'Board', 'Result', 'VPIP', 'PFR', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hands.map((hand, i) => (
                  <tr key={hand.id} style={{ borderBottom: '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'var(--bg-base)' : 'var(--bg-surface)' }}>
                    <td style={{ padding: '9px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(hand.played_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '9px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {hand.hero_position || '—'}
                    </td>
                    <td style={{ padding: '9px 12px' }}>
                      {hand.hero_hole_cards ? <CardsDisplay cards={hand.hero_hole_cards} /> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px' }}>
                      {hand.board ? <CardsDisplay cards={hand.board} /> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '9px 12px', fontWeight: 700, fontFamily: 'monospace', color: hand.hero_result >= 0 ? 'var(--info)' : 'var(--danger)', whiteSpace: 'nowrap' }}>
                      {bbDisplay(hand.hero_result, hand.stakes_bb)}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}><Badge on={hand.vpip} /></td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}><Badge on={hand.pfr} /></td>
                    <td style={{ padding: '9px 12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {hand.board && hand.hero_hole_cards && (
                        <button
                          onClick={() => setGtoHand(hand)}
                          style={{ padding: '3px 7px', borderRadius: '5px', border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent-text)', cursor: 'pointer', fontSize: '10px', fontWeight: 700, whiteSpace: 'nowrap' }}
                        >
                          GTO
                        </button>
                      )}
                      <button onClick={() => handleDelete(hand.id)} style={{ padding: '3px 8px', borderRadius: '5px', border: '1px solid var(--danger)', background: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '11px' }}>✕</button>
                    </td>
                  </tr>
                ))}
                {hands.length === 0 && !loading && (
                  <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontStyle: 'italic' }}>No hands match the current filters. Upload a PokerStars hand history file.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {total > PER_PAGE && (
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '16px' }}>
              <PagBtn label="← Prev" disabled={page === 1} onClick={() => { const p = page - 1; setPage(p); load(p); }} />
              <span style={{ padding: '6px 12px', fontSize: '12px', color: 'var(--text-muted)' }}>
                {page} / {Math.ceil(total / PER_PAGE)}
              </span>
              <PagBtn label="Next →" disabled={page >= Math.ceil(total / PER_PAGE)} onClick={() => { const p = page + 1; setPage(p); load(p); }} />
            </div>
          )}
        </>
      )}

      {/* GTO Modal */}
      {gtoHand && selectedPlayer && (
        <GTOModal hand={gtoHand} playerName={selectedPlayer} onClose={() => setGtoHand(null)} />
      )}
    </div>
  );
}

function btnStyle(disabled: boolean): CSSProperties {
  return {
    padding: '9px 18px', borderRadius: '9px', border: '1px solid var(--border)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600,
    opacity: disabled ? 0.5 : 1,
  };
}

function Badge({ on }: { on: boolean }) {
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: on ? 'var(--info)' : 'var(--bg-hover)' }} />;
}

function PagBtn({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{ padding: '6px 14px', borderRadius: '7px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: disabled ? 'var(--text-muted)' : 'var(--text-primary)', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '12px' }}>
      {label}
    </button>
  );
}

const selectStyle: CSSProperties = {
  padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: '12px', cursor: 'pointer',
};

const inputStyle: CSSProperties = {
  padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--border)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: '12px',
};
