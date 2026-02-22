import { useState } from 'react';
import { getSpots, startSession, submitAction, completeSession } from '../api/trainer';
import { usePlayer } from '../contexts/PlayerContext';
import { SUIT_SYMBOLS, SUIT_COLORS, type Suit } from '../lib/poker';

interface Spot {
  id: string; spot_key: string; label: string; position_matchup: string;
  board_texture: string; board: string; solve_status: string;
}

interface GameState {
  session_id: string; hero_combo: string; hero_position: string; board: string;
  pot: number; effective_stack: number; node_path: string[]; node_type: string;
  available_actions: { name: string; gto_freq: number }[];
  villain_action: string | null; is_terminal: boolean; street: string;
  scenario_context: string | null;
}

interface Decision {
  chosen_action: string; gto_freq: number; node_path: string[];
}

type Screen = 'picker' | 'game' | 'result';

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
      fontSize: large ? '18px' : '13px',
      fontWeight: 800, lineHeight: 1,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <span style={{ color: 'var(--text-primary)' }}>{rank}</span>
      <span style={{ color, fontSize: large ? '12px' : '9px' }}>{sym}</span>
    </span>
  );
}

function BoardDisplay({ board }: { board: string }) {
  const cards = board.replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {cards.map((c, i) => <CardDisplay key={i} card={c} />)}
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
      setDecisions(prev => [...prev, { chosen_action: action, gto_freq: chosen?.gto_freq ?? 0, node_path: gameState.node_path }]);

      if (next.villain_action) setVillainMsg(formatVillainAction(next.villain_action));

      if (next.is_terminal) {
        const result = await completeSession(gameState.session_id);
        setScore(result.gto_score);
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

  // ── NO PLAYER ─────────────────────────────────────────────────────────────
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

  // ── PICKER ────────────────────────────────────────────────────────────────
  if (screen === 'picker') {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>GTO Trainer</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
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
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>{spot.label}</div>
              <div style={{ marginBottom: '8px' }}><BoardDisplay board={spot.board} /></div>
              <StatusBadge status={spot.solve_status} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── GAME ──────────────────────────────────────────────────────────────────
  if (screen === 'game' && gameState) {
    const holeCards = gameState.hero_combo.match(/.{2}/g) || [];
    return (
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Position: <strong style={{ color: 'var(--text-primary)', textTransform: 'uppercase' }}>{gameState.hero_position}</strong>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={hintMode} onChange={e => setHintMode(e.target.checked)} />
            GTO hints
          </label>
        </div>

        {gameState.scenario_context && (
          <div style={{
            marginBottom: '16px', padding: '10px 16px', borderRadius: '10px',
            background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center',
            letterSpacing: '0.01em',
          }}>
            {gameState.scenario_context}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', marginBottom: '28px' }}>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Your Hand</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {holeCards.map((c, i) => <CardDisplay key={i} card={c} large />)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Board</div>
            <BoardDisplay board={gameState.board} />
          </div>
          <div style={{ padding: '8px 20px', borderRadius: '20px', background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-primary)', fontWeight: 700 }}>
            Pot: {gameState.pot} · Stack: {gameState.effective_stack}
          </div>
        </div>

        {villainMsg && (
          <div style={{ textAlign: 'center', marginBottom: '16px', padding: '10px 16px', borderRadius: '10px', background: 'rgba(88,166,255,0.06)', border: '1px solid rgba(88,166,255,0.25)', fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 600 }}>
            {villainMsg}
          </div>
        )}

        {error && <ErrBanner msg={error} />}
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
          Your Action
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px' }}>
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
                <span style={{ fontSize: '13px', fontWeight: 800, color, position: 'relative', zIndex: 1 }}>{name}</span>
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
    );
  }

  // ── RESULT ────────────────────────────────────────────────────────────────
  if (screen === 'result') {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 20px', display: 'flex', flexDirection: 'column', gap: '28px', alignItems: 'center' }}>
        <ScoreGauge score={score ?? 0} />

        <div style={{ width: '100%' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '10px' }}>Decision Review</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {decisions.map((d, i) => {
              const color = actionColor(d.chosen_action);
              const pct = Math.round(d.gto_freq * 100);
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '13px', color: 'var(--text-secondary)' }}>Action {i + 1}</span>
                  <span style={{ fontSize: '13px', fontWeight: 700, color }}>{d.chosen_action}</span>
                  <span style={{ fontSize: '12px', color: pct >= 60 ? 'var(--info)' : pct >= 30 ? 'var(--warning)' : 'var(--danger)', fontFamily: 'monospace', fontWeight: 700 }}>
                    {pct}% GTO
                  </span>
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

  return null;
}

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

function btnStyle(bg: string, border: string): React.CSSProperties {
  return {
    padding: '9px 18px', borderRadius: '9px', border: `1px solid ${border}`,
    background: bg, color: bg === 'var(--accent)' ? '#fff' : 'var(--text-primary)',
    cursor: 'pointer', fontSize: '13px', fontWeight: 600,
  };
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

function formatVillainAction(action: string): string {
  const a = action.toUpperCase().trim();
  if (a === 'CHECK') return 'Villain checks';
  if (a === 'CALL') return 'Villain calls';
  if (a === 'FOLD') return 'Villain folds';
  if (a === 'ALLIN' || a.includes('ALLIN')) return 'Villain goes all-in';
  const betM = a.match(/^BET[_\s]?([\d.]+)/);
  if (betM) return `Villain bets ${Math.round(parseFloat(betM[1]))}% pot`;
  const raiseM = a.match(/^RAISE[_\s]?([\d.]+)/);
  if (raiseM) return `Villain raises ${Math.round(parseFloat(raiseM[1]))}% pot`;
  return `Villain: ${action}`;
}
