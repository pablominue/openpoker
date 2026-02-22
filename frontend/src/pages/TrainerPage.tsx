import { useState, useEffect, type CSSProperties } from 'react';
import { getSpots, startSession, submitAction, completeSession, getNodeStrategy, getTrainerStats, getSessions } from '../api/trainer';
import { usePlayer } from '../contexts/PlayerContext';
import { SUIT_SYMBOLS, SUIT_COLORS, type Suit } from '../lib/poker';
import HandStrategyMatrix from '../components/StrategyViewer/HandStrategyMatrix';
import type { ActionEntry } from '../types/solver';

// ── Interfaces ──────────────────────────────────────────────────────────────

interface Spot {
  id: string; spot_key: string; label: string; position_matchup: string;
  board_texture: string; board: string; solve_status: string;
}

interface GameState {
  session_id: string; hero_combo: string; hero_position: string; board: string;
  pot: number; effective_stack: number; node_path: string[]; node_type: string;
  available_actions: { name: string; gto_freq: number }[];
  villain_action: string | null; is_terminal: boolean; street: string;
  scenario_context: string | null; action_history: string[];
  position_matchup: string;
}

interface Decision {
  chosen_action: string; gto_freq: number; node_path: string[];
  all_actions: { name: string; gto_freq: number }[]; street: string;
}

interface NodeStrategy {
  strategy: Record<string, number[]>;
  entries: ActionEntry[];
}

interface SpotStatOut {
  spot_key: string; label: string; position_matchup: string;
  board_texture: string; hero_position: string; sessions_count: number;
  avg_gto_score: number; best_score: number | null; worst_score: number | null;
  last_played_at: string | null;
}

interface StatsData {
  total_sessions: number; avg_gto_score: number;
  best_score: number | null; worst_score: number | null;
  last_played_at: string | null; by_spot: SpotStatOut[];
}

interface SessionRecord {
  id: string; spot_key: string; hero_combo: string; hero_position: string;
  started_at: string; completed_at: string | null; gto_score: number | null;
}

type Screen = 'picker' | 'game' | 'result' | 'history';
type SidebarTab = 'range' | 'stats';

// ── Position labels ─────────────────────────────────────────────────────────

const POSITION_LABELS: Record<string, { ip: string; oop: string }> = {
  'BTN_vs_BB':      { ip: 'BTN', oop: 'BB'  },
  'CO_vs_BB':       { ip: 'CO',  oop: 'BB'  },
  'SB_vs_BB':       { ip: 'BB',  oop: 'SB'  },
  'HJ_vs_BB':       { ip: 'HJ',  oop: 'BB'  },
  'BTN_vs_SB_3bet': { ip: 'BTN', oop: 'SB'  },
  'CO_vs_BB_3bet':  { ip: 'CO',  oop: 'BB'  },
};

function getSeats(positionMatchup: string, heroPosition: string): { hero: string; villain: string } {
  const labels = POSITION_LABELS[positionMatchup] ?? { ip: 'IP', oop: 'OOP' };
  return heroPosition === 'ip'
    ? { hero: labels.ip, villain: labels.oop }
    : { hero: labels.oop, villain: labels.ip };
}

// ── Chips / formatting helpers ──────────────────────────────────────────────

function chipsToDisplay(chips: number): string {
  const bb = chips / 10;
  return Number.isInteger(bb) ? `${bb}bb` : `${parseFloat(bb.toFixed(1))}bb`;
}

function formatActionName(name: string): string {
  const upper = name.toUpperCase().replace(/_/g, ' ').trim();
  if (upper === 'FOLD') return 'Fold';
  if (upper === 'CHECK') return 'Check';
  if (upper === 'CALL') return 'Call';
  if (upper === 'ALLIN' || upper === 'ALL IN') return 'All-In';
  const betM = upper.match(/^BET\s+([\d.]+)$/);
  if (betM) return `Bet ${chipsToDisplay(parseFloat(betM[1]))}`;
  const raiseM = upper.match(/^RAISE\s+([\d.]+)$/);
  if (raiseM) return `Raise ${chipsToDisplay(parseFloat(raiseM[1]))}`;
  return name;
}

function formatVillainAction(action: string): string {
  const upper = action.toUpperCase().replace(/_/g, ' ').trim();
  if (upper === 'CHECK') return 'Villain checks';
  if (upper === 'CALL') return 'Villain calls';
  if (upper === 'FOLD') return 'Villain folds';
  if (upper === 'ALLIN' || upper === 'ALL IN') return 'Villain goes all-in';
  const betM = upper.match(/^BET\s+([\d.]+)/);
  if (betM) return `Villain bets ${chipsToDisplay(parseFloat(betM[1]))}`;
  const raiseM = upper.match(/^RAISE\s+([\d.]+)/);
  if (raiseM) return `Villain raises ${chipsToDisplay(parseFloat(raiseM[1]))}`;
  return `Villain: ${action}`;
}

function actionColor(name: string): string {
  const n = name.toUpperCase();
  if (n.includes('FOLD')) return '#f85149';
  if (n.includes('CHECK')) return '#7d8590';
  if (n.includes('CALL')) return '#58a6ff';
  if (n.includes('ALL') || n.includes('ALLIN')) return '#bc8cff';
  if (n.includes('RAISE')) return '#d29922';
  if (n.includes('BET')) return '#3fb950';
  return '#58a6ff';
}

interface Grade { label: string; color: string; bg: string }
function gradeDecision(freq: number): Grade {
  if (freq >= 0.85) return { label: 'Best Move',   color: '#3fb950', bg: 'rgba(63,185,80,0.12)' };
  if (freq >= 0.60) return { label: 'Correct',     color: '#58a6ff', bg: 'rgba(88,166,255,0.12)' };
  if (freq >= 0.30) return { label: 'Inaccuracy',  color: '#d29922', bg: 'rgba(210,153,34,0.12)' };
  if (freq >= 0.10) return { label: 'Wrong',       color: '#f0883e', bg: 'rgba(240,136,62,0.12)' };
  return              { label: 'Blunder',     color: '#f85149', bg: 'rgba(248,81,73,0.12)' };
}

function formatHistoryStep(step: string): string {
  if (step.startsWith('[') && step.endsWith(']')) return step;
  const prefix = step.slice(0, 2);
  const action = step.slice(2);
  const label = formatActionName(action);
  return prefix === 'H:' ? label : `(${label})`;
}

// ── Card components ─────────────────────────────────────────────────────────

// White card for rendering ON the poker table felt
function TableCard({ card, size = 'sm' }: { card: string; size?: 'sm' | 'md' }) {
  if (card.length !== 2) return <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '12px' }}>{card}</span>;
  const rank = card[0];
  const suit = card[1] as Suit;
  // On felt we use classic red/black instead of theme colors
  const isRed = suit === 'h' || suit === 'd';
  const color = isRed ? '#e53935' : '#1a1a1a';
  const sym = SUIT_SYMBOLS[suit] ?? suit;
  const w = size === 'md' ? 44 : 34;
  const h = size === 'md' ? 60 : 46;
  return (
    <span style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      width: w, height: h, borderRadius: '6px',
      background: '#f5f5f5',
      border: '1px solid rgba(0,0,0,0.12)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      fontSize: size === 'md' ? '15px' : '12px', fontWeight: 800, lineHeight: 1, gap: '1px',
      flexShrink: 0,
    }}>
      <span style={{ color: '#1a1a1a' }}>{rank}</span>
      <span style={{ color, fontSize: size === 'md' ? '10px' : '8px' }}>{sym}</span>
    </span>
  );
}

// Dark-backed face-down card
function FaceDownCard({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const w = size === 'md' ? 44 : 34;
  const h = size === 'md' ? 60 : 46;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: w, height: h, borderRadius: '6px',
      background: 'linear-gradient(135deg, #1a3a8e 30%, #0d2266 70%)',
      border: '1px solid rgba(255,255,255,0.2)',
      boxShadow: '0 2px 6px rgba(0,0,0,0.35)',
      fontSize: '14px', color: 'rgba(255,255,255,0.25)', flexShrink: 0,
    }}>
      ?
    </span>
  );
}

// Theme card for non-table use (existing component)
function CardDisplay({ card, large }: { card: string; large?: boolean }) {
  if (card.length !== 2) return <span>{card}</span>;
  const rank = card[0];
  const suit = card[1] as Suit;
  const color = SUIT_COLORS[suit] ?? '#fff';
  const sym = SUIT_SYMBOLS[suit] ?? suit;
  return (
    <span style={{
      display: 'inline-flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      width: large ? 52 : 36, height: large ? 70 : 50,
      borderRadius: large ? '10px' : '7px',
      background: 'var(--bg-elevated)',
      border: `1.5px solid ${color}60`,
      fontSize: large ? '18px' : '13px', fontWeight: 800, lineHeight: 1,
      boxShadow: 'var(--shadow-sm)', flexShrink: 0,
    }}>
      <span style={{ color: 'var(--text-primary)' }}>{rank}</span>
      <span style={{ color, fontSize: large ? '12px' : '9px' }}>{sym}</span>
    </span>
  );
}

// ── Poker Table ─────────────────────────────────────────────────────────────

interface PokerTableProps {
  heroCombo: string;
  heroPosition: string;
  positionMatchup: string;
  board: string;
  pot: number;
  effectiveStack: number;
  villainAction: string | null;
}

function PokerTable({ heroCombo, heroPosition, positionMatchup, board, pot, effectiveStack, villainAction }: PokerTableProps) {
  const holeCards = heroCombo.match(/.{2}/g) || [];
  const boardCards = board.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  const seats = getSeats(positionMatchup, heroPosition);

  return (
    <div style={{
      width: '100%',
      height: '260px',
      borderRadius: '50%',
      background: 'radial-gradient(ellipse at center, #1f6b3a 0%, #175530 55%, #0f3d22 100%)',
      border: '8px solid #5c3009',
      boxShadow: '0 0 0 2px #8a6410, inset 0 0 50px rgba(0,0,0,0.45), 0 6px 28px rgba(0,0,0,0.55)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '20px 50px',
      boxSizing: 'border-box',
      position: 'relative',
      flexShrink: 0,
    }}>
      {/* Villain seat (top) */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
        {villainAction && (
          <div style={{
            fontSize: '10px', fontWeight: 700, color: 'rgba(255,255,255,0.9)',
            background: 'rgba(88,166,255,0.25)', border: '1px solid rgba(88,166,255,0.4)',
            padding: '2px 8px', borderRadius: '8px', marginBottom: '2px',
            whiteSpace: 'nowrap',
          }}>
            {formatVillainAction(villainAction)}
          </div>
        )}
        <div style={{
          fontSize: '10px', fontWeight: 800,
          color: 'rgba(255,255,255,0.7)',
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.15)',
          padding: '2px 8px', borderRadius: '10px',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          {seats.villain}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <FaceDownCard />
          <FaceDownCard />
        </div>
      </div>

      {/* Board + pot in center */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px' }}>
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {boardCards.map((c, i) => <TableCard key={i} card={c} />)}
        </div>
        <div style={{
          fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.85)',
          background: 'rgba(0,0,0,0.35)', padding: '3px 12px', borderRadius: '20px',
          letterSpacing: '0.02em',
        }}>
          {chipsToDisplay(pot)} pot · {chipsToDisplay(effectiveStack)} eff
        </div>
      </div>

      {/* Hero seat (bottom) */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          {holeCards.map((c, i) => <TableCard key={i} card={c} size="md" />)}
        </div>
        <div style={{
          fontSize: '10px', fontWeight: 800,
          color: '#4ade80',
          background: 'rgba(74,222,128,0.18)',
          border: '1px solid rgba(74,222,128,0.35)',
          padding: '2px 8px', borderRadius: '10px',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          YOU · {seats.hero}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StreetChip({ street }: { street: string }) {
  const map: Record<string, [string, string]> = {
    flop:  ['Flop',  'var(--info)'],
    turn:  ['Turn',  'var(--warning)'],
    river: ['River', 'var(--danger)'],
  };
  const [label, color] = map[street] ?? [street, 'var(--text-muted)'];
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, color,
      background: `${color}18`, padding: '2px 8px',
      borderRadius: '20px', border: `1px solid ${color}40`,
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {label}
    </span>
  );
}

function ActionHistoryBar({ history }: { history: string[] }) {
  if (!history.length) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px',
      padding: '8px 12px', borderRadius: '9px',
      background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
      marginBottom: '14px', fontSize: '11px',
    }}>
      {history.map((step, i) => {
        const isCard = step.startsWith('[');
        const isHero = step.startsWith('H:');
        const label = formatHistoryStep(step);
        return (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {i > 0 && <span style={{ color: 'var(--text-muted)', fontSize: '9px' }}>›</span>}
            <span style={{
              fontWeight: isCard ? 700 : 600,
              color: isCard ? 'var(--warning)' : isHero ? 'var(--text-primary)' : 'var(--text-muted)',
              background: isCard ? 'rgba(210,153,34,0.12)' : isHero ? 'var(--bg-elevated)' : 'transparent',
              padding: isCard || isHero ? '1px 5px' : '0',
              borderRadius: '4px',
            }}>
              {label}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 75 ? 'var(--info)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '64px', fontWeight: 900, color, lineHeight: 1 }}>{pct}<span style={{ fontSize: '28px' }}>%</span></div>
      <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px' }}>GTO Score</div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-base)', marginTop: 12, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4, transition: 'width 0.8s ease' }} />
      </div>
    </div>
  );
}

function FreqBar({ actions }: { actions: { name: string; gto_freq: number }[] }) {
  const total = actions.reduce((s, a) => s + a.gto_freq, 0) || 1;
  return (
    <div style={{ display: 'flex', height: '10px', borderRadius: '5px', overflow: 'hidden', width: '100%' }}>
      {actions.map(a => (
        <div
          key={a.name}
          style={{ flex: a.gto_freq / total, background: actionColor(a.name), transition: 'flex 0.3s' }}
          title={`${formatActionName(a.name)}: ${Math.round(a.gto_freq * 100)}%`}
        />
      ))}
    </div>
  );
}

// ── Session Stats ───────────────────────────────────────────────────────────

const GRADE_LABELS = ['Best Move', 'Correct', 'Inaccuracy', 'Wrong', 'Blunder'] as const;
const GRADE_FREQS: Record<string, number> = {
  'Best Move': 1, 'Correct': 0.7, 'Inaccuracy': 0.45, 'Wrong': 0.2, 'Blunder': 0.05,
};

function SessionStats({ decisions }: { decisions: Decision[] }) {
  if (decisions.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', padding: '24px 12px' }}>
        No decisions yet — make a move to see stats.
      </div>
    );
  }
  const avgScore = decisions.reduce((s, d) => s + d.gto_freq, 0) / decisions.length;
  const pct = Math.round(avgScore * 100);
  const scoreColor = pct >= 75 ? '#3fb950' : pct >= 50 ? '#d29922' : '#f85149';
  const gradeCounts: Record<string, number> = {};
  decisions.forEach(d => {
    const g = gradeDecision(d.gto_freq).label;
    gradeCounts[g] = (gradeCounts[g] || 0) + 1;
  });

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Running score */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '42px', fontWeight: 900, color: scoreColor, lineHeight: 1 }}>
          {pct}<span style={{ fontSize: '18px' }}>%</span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          Running GTO Score ({decisions.length} decision{decisions.length > 1 ? 's' : ''})
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-base)', marginTop: 8, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: scoreColor, borderRadius: 3, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Grade chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center' }}>
        {GRADE_LABELS.map(label => {
          const count = gradeCounts[label] || 0;
          if (!count) return null;
          const g = gradeDecision(GRADE_FREQS[label]);
          return (
            <span key={label} style={{
              fontSize: '10px', fontWeight: 700, color: g.color,
              background: g.bg, padding: '2px 7px', borderRadius: '20px',
              border: `1px solid ${g.color}40`,
            }}>
              {count}× {label}
            </span>
          );
        })}
      </div>

      {/* Per-decision list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {decisions.map((d, i) => {
          const grade = gradeDecision(d.gto_freq);
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 10px', borderRadius: '8px',
              background: 'var(--bg-base)', border: `1px solid ${grade.color}25`,
            }}>
              <StreetChip street={d.street ?? 'flop'} />
              <span style={{ flex: 1, fontSize: '11px', color: actionColor(d.chosen_action), fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {formatActionName(d.chosen_action)}
              </span>
              <span style={{
                fontSize: '10px', fontWeight: 700, color: grade.color,
                background: grade.bg, padding: '1px 6px', borderRadius: '10px', flexShrink: 0,
              }}>
                {Math.round(d.gto_freq * 100)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Range Panel ─────────────────────────────────────────────────────────────

function RangePanel({ nodeStrategy, heroCombo }: { nodeStrategy: NodeStrategy | null; heroCombo: string }) {
  if (!nodeStrategy) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 12px' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Loading range…</div>
      </div>
    );
  }
  if (!nodeStrategy.strategy || Object.keys(nodeStrategy.strategy).length === 0) {
    return (
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', padding: '16px' }}>
        No strategy data available.
      </div>
    );
  }

  // Highlight hero's combo cell
  const heroCell = heroCombo;

  return (
    <div style={{ padding: '10px 8px' }}>
      {/* Action legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px', justifyContent: 'center' }}>
        {nodeStrategy.entries.map(e => (
          <span key={e.name} style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            fontSize: '9px', fontWeight: 700, color: 'var(--text-secondary)',
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '2px', background: actionColor(e.name), display: 'inline-block', flexShrink: 0 }} />
            {formatActionName(e.name)}
          </span>
        ))}
      </div>
      {/* Hero combo indicator */}
      {heroCell && (
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '6px' }}>
          Your hand: <strong style={{ color: 'var(--text-primary)' }}>{heroCombo.match(/.{2}/g)?.join(' ') ?? heroCombo}</strong>
        </div>
      )}
      <HandStrategyMatrix strategy={nodeStrategy.strategy} entries={nodeStrategy.entries} />
    </div>
  );
}

// ── History / Stats components ───────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{
      padding: '16px', borderRadius: '12px',
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '24px', fontWeight: 900, color: color ?? 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{label}</div>
    </div>
  );
}

function ScoreTrendChart({ sessions }: { sessions: SessionRecord[] }) {
  const completed = [...sessions].filter(s => s.gto_score !== null).reverse();
  if (completed.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '56px' }}>
      {completed.map((s, i) => {
        const pct = Math.round((s.gto_score ?? 0) * 100);
        const color = pct >= 75 ? '#3fb950' : pct >= 50 ? '#d29922' : '#f85149';
        return (
          <div
            key={i}
            title={`${pct}% · ${s.spot_key} (${s.hero_position.toUpperCase()})`}
            style={{
              flex: 1, height: `${Math.max(pct, 4)}%`, minHeight: 3,
              background: color, borderRadius: '2px 2px 0 0', opacity: 0.85,
              transition: 'opacity 0.15s', cursor: 'default',
            }}
          />
        );
      })}
    </div>
  );
}

function SpotStatsTable({ spots }: { spots: SpotStatOut[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {spots.map((s, i) => {
        const pct = Math.round(s.avg_gto_score * 100);
        const color = pct >= 75 ? '#3fb950' : pct >= 50 ? '#d29922' : '#f85149';
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: '10px 14px', borderRadius: '10px',
            background: 'var(--bg-surface)', border: `1px solid ${color}25`,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.label}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {s.position_matchup} · {s.hero_position.toUpperCase()} · {s.sessions_count} session{s.sessions_count !== 1 ? 's' : ''}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
              <span style={{ fontSize: '20px', fontWeight: 900, color, lineHeight: 1 }}>{pct}%</span>
              {s.best_score !== null && s.worst_score !== null && (
                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                  best {Math.round(s.best_score * 100)}% · worst {Math.round(s.worst_score * 100)}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HistoryScreen({ playerName }: { playerName: string }) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([getTrainerStats(playerName), getSessions(playerName)])
      .then(([s, sess]) => {
        setStats(s);
        setSessions(sess);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [playerName]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading stats…</div>;
  }
  if (error) {
    return <ErrBanner msg={error} />;
  }

  const completedSessions = sessions.filter(s => s.gto_score !== null);
  const recentSessions = completedSessions.slice(0, 30);
  const noData = !stats || stats.total_sessions === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
        <StatCard label="Sessions" value={stats?.total_sessions ?? 0} />
        <StatCard
          label="Avg Score"
          value={stats && stats.total_sessions > 0 ? `${Math.round(stats.avg_gto_score * 100)}%` : '—'}
          color={stats && stats.avg_gto_score >= 0.75 ? '#3fb950' : stats && stats.avg_gto_score >= 0.5 ? '#d29922' : '#f85149'}
        />
        <StatCard
          label="Best"
          value={stats?.best_score != null ? `${Math.round(stats.best_score * 100)}%` : '—'}
          color="#3fb950"
        />
        <StatCard
          label="Worst"
          value={stats?.worst_score != null ? `${Math.round(stats.worst_score * 100)}%` : '—'}
          color="#f85149"
        />
      </div>

      {noData && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
          No completed sessions yet. Play some spots to see your stats!
        </div>
      )}

      {/* Score trend */}
      {recentSessions.length > 0 && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '12px', padding: '16px',
        }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
            Score Trend · last {recentSessions.length} sessions (oldest → newest)
          </div>
          <ScoreTrendChart sessions={recentSessions} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>0%</span>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>100%</span>
          </div>
        </div>
      )}

      {/* Per-spot breakdown */}
      {stats && stats.by_spot.length > 0 && (
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
            Performance by Spot · worst first
          </div>
          <SpotStatsTable spots={stats.by_spot} />
        </div>
      )}
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function TrainerPage() {
  const { selectedPlayer } = usePlayer();
  const [screen, setScreen] = useState<Screen>('picker');
  const [spots, setSpots] = useState<Spot[]>([]);
  const [spotsLoaded, setSpotsLoaded] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hintMode, setHintMode] = useState(false);
  const [villainMsg, setVillainMsg] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('range');
  const [nodeStrategy, setNodeStrategy] = useState<NodeStrategy | null>(null);

  // Fetch GTO strategy for the current node whenever the game state advances
  const nodePathKey = gameState ? gameState.node_path.join(',') : '';
  useEffect(() => {
    if (!gameState || screen !== 'game') {
      setNodeStrategy(null);
      return;
    }
    const sid = gameState.session_id;
    const path = gameState.node_path;
    let cancelled = false;
    setNodeStrategy(null);
    getNodeStrategy(sid, path).then(data => {
      if (!cancelled) setNodeStrategy(data);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodePathKey, screen]);

  const loadSpots = async () => {
    setLoading(true);
    try {
      const data = await getSpots();
      setSpots(data);
      setSpotsLoaded(true);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const start = async (spot_id?: string) => {
    if (!selectedPlayer) {
      setError('Select a player first using the top-right selector.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const state = await startSession(selectedPlayer, spot_id);
      setGameState(state);
      setDecisions([]);
      setVillainMsg(state.villain_action ? formatVillainAction(state.villain_action) : null);
      setNodeStrategy(null);
      setScreen('game');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const act = async (action: string) => {
    if (!gameState) return;
    setLoading(true);
    setVillainMsg(null);
    try {
      const next = await submitAction(gameState.session_id, gameState.node_path, action, gameState.pot);
      const chosen = gameState.available_actions.find(a => a.name === action);
      setDecisions(prev => [...prev, {
        chosen_action: action,
        gto_freq: chosen?.gto_freq ?? 0,
        node_path: gameState.node_path,
        all_actions: gameState.available_actions,
        street: gameState.street,
      }]);

      if (next.villain_action) setVillainMsg(formatVillainAction(next.villain_action));

      if (next.is_terminal) {
        const result = await completeSession(gameState.session_id);
        setScore(result.gto_score);
        if (result.decisions?.length) {
          setDecisions(result.decisions.map((d: Decision) => ({
            chosen_action: d.chosen_action,
            gto_freq: d.gto_freq,
            node_path: d.node_path ?? [],
            all_actions: d.all_actions ?? [],
            street: d.street ?? 'flop',
          })));
        }
        setScreen('result');
      } else {
        setGameState(next);
      }
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const readySpots = spots.filter(s => s.solve_status === 'ready');

  // ── NO PLAYER ──────────────────────────────────────────────────────────────
  if (!selectedPlayer && screen === 'picker') {
    return (
      <div style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎯</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
          Select a player to start training
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Use the player selector in the top-right corner.
        </div>
      </div>
    );
  }

  // ── PICKER ─────────────────────────────────────────────────────────────────
  if (screen === 'picker') {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>GTO Trainer</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            {selectedPlayer && (
              <button onClick={() => setScreen('history')} style={btnStyle('var(--bg-elevated)', 'var(--border)')}>
                History
              </button>
            )}
            {!spotsLoaded && (
              <button onClick={loadSpots} disabled={loading} style={btnStyle('var(--bg-elevated)', 'var(--border)')}>
                {loading ? 'Loading…' : 'Load Spots'}
              </button>
            )}
            {readySpots.length > 0 && (
              <button onClick={() => start()} disabled={loading} style={btnStyle('var(--accent)', 'var(--accent)')}>
                {loading ? 'Starting…' : '▶ Random Spot'}
              </button>
            )}
          </div>
        </div>

        {error && <ErrBanner msg={error} />}

        {spotsLoaded && spots.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)', fontSize: '13px' }}>
            No spots found. The server may still be solving. Try again in a few minutes.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
          {spots.map(spot => (
            <div
              key={spot.id}
              onClick={() => spot.solve_status === 'ready' && start(spot.id)}
              style={{
                padding: '16px', borderRadius: '12px',
                border: `1px solid ${spot.solve_status === 'ready' ? 'var(--accent)' : 'var(--border)'}`,
                background: spot.solve_status === 'ready' ? 'var(--accent-dim)' : 'var(--bg-surface)',
                cursor: spot.solve_status === 'ready' ? 'pointer' : 'default',
                opacity: spot.solve_status === 'failed' ? 0.4 : 1,
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>{spot.label}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{spot.position_matchup} · {spot.board_texture}</div>
              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {spot.board.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean).map((c, i) => (
                  <CardDisplay key={i} card={c} />
                ))}
              </div>
              <StatusBadge status={spot.solve_status} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── GAME ───────────────────────────────────────────────────────────────────
  if (screen === 'game' && gameState) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 20px' }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              Position: <strong style={{ color: 'var(--text-primary)', textTransform: 'uppercase' }}>{gameState.hero_position}</strong>
            </span>
            <StreetChip street={gameState.street} />
            {gameState.scenario_context && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                {gameState.scenario_context}
              </span>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={hintMode} onChange={e => setHintMode(e.target.checked)} />
            GTO hints
          </label>
        </div>

        {/* Action history breadcrumb */}
        {gameState.action_history.length > 0 && (
          <ActionHistoryBar history={gameState.action_history} />
        )}

        {/* Two-column layout: main (table + actions) | sidebar (range + stats) */}
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>

          {/* ── Main column ─────────────────────────────────────────────── */}
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
            <PokerTable
              heroCombo={gameState.hero_combo}
              heroPosition={gameState.hero_position}
              positionMatchup={gameState.position_matchup}
              board={gameState.board}
              pot={gameState.pot}
              effectiveStack={gameState.effective_stack}
              villainAction={villainMsg ? gameState.villain_action : null}
            />

            {/* Villain action banner (below table) */}
            {villainMsg && (
              <div style={{
                textAlign: 'center', padding: '10px 16px',
                borderRadius: '10px', background: 'rgba(88,166,255,0.08)',
                border: '1.5px solid rgba(88,166,255,0.35)',
                fontSize: '14px', color: 'var(--text-primary)', fontWeight: 700,
              }}>
                {villainMsg}
              </div>
            )}

            {error && <ErrBanner msg={error} />}

            {/* Action buttons */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                Your Action
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '10px' }}>
                {gameState.available_actions.map(({ name, gto_freq }) => {
                  const color = actionColor(name);
                  const barWidth = hintMode ? `${Math.round(gto_freq * 100)}%` : '0%';
                  return (
                    <button
                      key={name}
                      onClick={() => act(name)}
                      disabled={loading}
                      style={{
                        position: 'relative', overflow: 'hidden',
                        padding: '18px 12px', borderRadius: '12px',
                        border: `1.5px solid ${color}60`,
                        background: `${color}14`,
                        color: 'var(--text-primary)',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
                        transition: 'all 0.15s',
                      }}
                    >
                      <div style={{ position: 'absolute', left: 0, bottom: 0, height: '100%', width: barWidth, background: `${color}18`, transition: 'width 0.4s ease', pointerEvents: 'none' }} />
                      <span style={{ fontSize: '13px', fontWeight: 800, color, position: 'relative', zIndex: 1 }}>{formatActionName(name)}</span>
                      {hintMode && (
                        <span style={{ fontSize: '18px', fontWeight: 900, color, position: 'relative', zIndex: 1, lineHeight: 1 }}>
                          {Math.round(gto_freq * 100)}%
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Sidebar ─────────────────────────────────────────────────── */}
          <div style={{
            flex: '0 0 280px', minWidth: 0,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: '12px', overflow: 'hidden',
          }}>
            {/* Tab bar */}
            <div style={{
              display: 'flex', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
            }}>
              {(['range', 'stats'] as SidebarTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setSidebarTab(tab)}
                  style={{
                    flex: 1, padding: '10px', border: 'none', cursor: 'pointer',
                    fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                    background: sidebarTab === tab ? 'var(--bg-surface)' : 'transparent',
                    color: sidebarTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                    borderBottom: sidebarTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  {tab === 'range' ? 'Range' : 'Stats'}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={{ overflowY: 'auto', maxHeight: '420px' }}>
              {sidebarTab === 'range' ? (
                <RangePanel nodeStrategy={nodeStrategy} heroCombo={gameState.hero_combo} />
              ) : (
                <SessionStats decisions={decisions} />
              )}
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ── RESULT ─────────────────────────────────────────────────────────────────
  if (screen === 'result') {
    const totalDecisions = decisions.length;
    const gradeCounts: Record<string, number> = {};
    decisions.forEach(d => {
      const g = gradeDecision(d.gto_freq).label;
      gradeCounts[g] = (gradeCounts[g] || 0) + 1;
    });

    return (
      <div style={{ maxWidth: 620, margin: '0 auto', padding: '40px 20px', display: 'flex', flexDirection: 'column', gap: '28px', alignItems: 'center' }}>
        <ScoreGauge score={score ?? 0} />

        {totalDecisions > 0 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {GRADE_LABELS.map(label => {
              const count = gradeCounts[label] || 0;
              if (!count) return null;
              const g = gradeDecision(GRADE_FREQS[label]);
              return (
                <span key={label} style={{
                  fontSize: '11px', fontWeight: 700, color: g.color,
                  background: g.bg, padding: '3px 10px', borderRadius: '20px',
                  border: `1px solid ${g.color}40`,
                }}>
                  {count}× {label}
                </span>
              );
            })}
          </div>
        )}

        <div style={{ width: '100%' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '10px' }}>Decision Review</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {decisions.map((d, i) => {
              const chosenColor = actionColor(d.chosen_action);
              const grade = gradeDecision(d.gto_freq);
              const bestAction = [...(d.all_actions || [])].sort((a, b) => b.gto_freq - a.gto_freq)[0];
              const isOptimal = bestAction?.name === d.chosen_action;
              return (
                <div key={i} style={{
                  padding: '12px 14px', borderRadius: '12px',
                  background: 'var(--bg-surface)', border: `1px solid ${grade.color}30`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <StreetChip street={d.street ?? 'flop'} />
                    <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-secondary)' }}>Decision {i + 1}</span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: chosenColor }}>{formatActionName(d.chosen_action)}</span>
                    <span style={{
                      fontSize: '11px', fontWeight: 700, color: grade.color,
                      background: grade.bg, padding: '2px 7px', borderRadius: '12px',
                    }}>{grade.label}</span>
                  </div>
                  {d.all_actions && d.all_actions.length > 0 && (
                    <div style={{ marginBottom: '6px' }}>
                      <FreqBar actions={d.all_actions} />
                    </div>
                  )}
                  {d.all_actions && d.all_actions.length > 0 && (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                      {[...d.all_actions].sort((a, b) => b.gto_freq - a.gto_freq).map(a => (
                        <span key={a.name} style={{
                          fontSize: '10px', fontWeight: 600,
                          color: a.name === d.chosen_action ? actionColor(a.name) : 'var(--text-muted)',
                          textDecoration: a.name === d.chosen_action ? 'underline' : 'none',
                        }}>
                          {formatActionName(a.name)} {Math.round(a.gto_freq * 100)}%
                          {a.name === d.chosen_action && ' ✓'}
                        </span>
                      ))}
                    </div>
                  )}
                  {!isOptimal && bestAction && (
                    <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>
                      Best: <span style={{ color: actionColor(bestAction.name), fontWeight: 700 }}>{formatActionName(bestAction.name)}</span> ({Math.round(bestAction.gto_freq * 100)}% GTO)
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => start()} style={btnStyle('var(--accent)', 'var(--accent)')}>Play Again</button>
          <button onClick={() => { setScreen('picker'); if (!spotsLoaded) loadSpots(); }} style={btnStyle('var(--bg-elevated)', 'var(--border)')}>New Spot</button>
        </div>
      </div>
    );
  }

  // ── HISTORY ────────────────────────────────────────────────────────────────
  if (screen === 'history' && selectedPlayer) {
    return (
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <button
            onClick={() => setScreen('picker')}
            style={btnStyle('var(--bg-elevated)', 'var(--border)')}
          >
            ← Spots
          </button>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>
            Training History · {selectedPlayer}
          </h1>
        </div>
        <HistoryScreen playerName={selectedPlayer} />
      </div>
    );
  }

  return null;
}

// ── Utility components ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    ready:   ['Ready', 'var(--info)'],
    solving: ['Solving…', 'var(--warning)'],
    pending: ['Pending', 'var(--text-muted)'],
    failed:  ['Failed', 'var(--danger)'],
  };
  const [label, color] = map[status] ?? [status, 'var(--text-muted)'];
  return (
    <span style={{ fontSize: '10px', fontWeight: 700, color, background: `${color}18`, padding: '2px 8px', borderRadius: '20px', border: `1px solid ${color}40` }}>
      {label}
    </span>
  );
}

function ErrBanner({ msg }: { msg: string }) {
  return (
    <div style={{ marginBottom: '16px', padding: '10px 14px', borderRadius: '9px', background: 'rgba(248,81,73,0.08)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: '12px' }}>
      {msg}
    </div>
  );
}

function btnStyle(bg: string, border: string): CSSProperties {
  return {
    padding: '9px 18px', borderRadius: '9px', border: `1px solid ${border}`,
    background: bg, color: bg === 'var(--accent)' ? '#fff' : 'var(--text-primary)',
    cursor: 'pointer', fontSize: '13px', fontWeight: 600,
  };
}
