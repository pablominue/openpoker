import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { getStatsSummary, getStatsByPosition, getStatsTimeline, reprocessHands, StatsFilters } from '../api/hands';
import { usePlayer } from '../contexts/PlayerContext';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine,
} from 'recharts';

interface Summary {
  total_hands: number;
  vpip_pct: number;
  pfr_pct: number;
  three_bet_pct: number;
  wtsd_pct: number;
  win_rate_bb_100: number;
  wssd_pct: number;
  wwsf_pct: number;
  af: number;
  cbet_pct: number;
}

interface PosStats {
  position: string;
  hands: number;
  vpip_pct: number;
  pfr_pct: number;
  win_rate_bb_100: number;
}

interface TimelinePoint {
  played_at: string;
  hand_id: string;
  result_cents: number;
  cumulative_cents: number;
  result_bb: number;
  cumulative_bb: number;
  display_val?: number;
}

const STAT_INFO: { key: keyof Summary; label: string; suffix: string; desc: string }[] = [
  { key: 'vpip_pct',        label: 'VPIP',      suffix: '%',      desc: 'Voluntarily put $ in pot' },
  { key: 'pfr_pct',         label: 'PFR',       suffix: '%',      desc: 'Preflop raise rate' },
  { key: 'three_bet_pct',   label: '3-Bet',     suffix: '%',      desc: '3-bet frequency' },
  { key: 'wtsd_pct',        label: 'WTSD',      suffix: '%',      desc: 'Went to showdown' },
  { key: 'wssd_pct',        label: 'W$SD',      suffix: '%',      desc: 'Won $ at showdown' },
  { key: 'wwsf_pct',        label: 'WWSF',      suffix: '%',      desc: 'Won when saw flop' },
  { key: 'af',              label: 'AF',        suffix: '',       desc: 'Postflop aggression factor' },
  { key: 'cbet_pct',        label: 'C-bet',     suffix: '%',      desc: 'Continuation bet %' },
  { key: 'win_rate_bb_100', label: 'Win Rate',  suffix: 'bb/100', desc: 'Net bb per 100 hands' },
  { key: 'total_hands',     label: 'Hands',     suffix: '',       desc: 'Total hands in selection' },
];

const POSITIONS = ['BTN', 'CO', 'HJ', 'SB', 'BB', 'EP'];

// ── Filter panel ───────────────────────────────────────────────────────────────

function FilterPanel({ filters, onChange }: { filters: StatsFilters; onChange: (f: StatsFilters) => void }) {
  const hasFilters = !!(filters.position || filters.three_bet_pot || filters.date_from || filters.date_to);
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center',
      padding: '14px 16px', borderRadius: '10px',
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      marginBottom: '24px',
    }}>
      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Filters
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
          style={{ accentColor: 'var(--accent)', width: 14, height: 14 }}
        />
        3-bet pots only
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

// ── Timeline tooltip ───────────────────────────────────────────────────────────

function TimelineTooltip({ active, payload, mode }: {
  active?: boolean;
  payload?: Array<{ value: number; payload: TimelinePoint }>;
  mode: 'eur' | 'bb';
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0];
  const cum = pt.value;
  const hand = mode === 'eur' ? pt.payload.result_cents / 100 : pt.payload.result_bb;
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 14px', fontSize: '11px' }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>{new Date(pt.payload.played_at).toLocaleDateString()}</div>
      <div style={{ fontWeight: 700, color: cum >= 0 ? 'var(--info)' : 'var(--danger)', fontSize: '14px' }}>
        {cum >= 0 ? '+' : ''}{cum.toFixed(2)}{mode === 'eur' ? '€' : ' bb'}
      </div>
      <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
        Hand: {hand >= 0 ? '+' : ''}{hand.toFixed(2)}{mode === 'eur' ? '€' : ' bb'}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const { selectedPlayer } = usePlayer();
  const [filters, setFilters] = useState<StatsFilters>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [posStats, setPosStats] = useState<PosStats[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recalcState, setRecalcState] = useState<'idle' | 'running' | 'done'>('idle');
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);
  const [timelineMode, setTimelineMode] = useState<'eur' | 'bb'>('eur');

  const loadStats = async (player: string, f: StatsFilters) => {
    setLoading(true);
    setSummary(null);
    setPosStats([]);
    setTimeline([]);
    setError(null);
    try {
      const [s, p, t] = await Promise.all([
        getStatsSummary(player, f),
        getStatsByPosition(player, f),
        getStatsTimeline(player, f),
      ]);
      setSummary(s);
      setPosStats(p);
      setTimeline(t);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selectedPlayer) return;
    loadStats(selectedPlayer, filters);
  }, [selectedPlayer, JSON.stringify(filters)]);

  const handleRecalculate = async () => {
    if (!selectedPlayer || recalcState === 'running') return;
    setRecalcState('running');
    setRecalcMsg(null);
    try {
      const result = await reprocessHands(selectedPlayer);
      setRecalcMsg(`Re-parsed ${result.reprocessed} hands. Stats updated.`);
      loadStats(selectedPlayer, filters);
    } catch (e) {
      setRecalcMsg(String(e));
    } finally {
      setRecalcState('done');
      setTimeout(() => setRecalcState('idle'), 4000);
    }
  };

  if (!selectedPlayer) {
    return (
      <div style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>Select a player to view stats</div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Use the player selector in the top-right corner.</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ maxWidth: 600, margin: '40px auto', padding: '16px', borderRadius: 10, background: 'rgba(248,81,73,0.08)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
        {error}
      </div>
    );
  }

  // Derive timeline display values
  const tlData: TimelinePoint[] = timeline.map(pt => ({
    ...pt,
    display_val: timelineMode === 'eur' ? pt.cumulative_cents / 100 : pt.cumulative_bb,
  }));
  const tlVals = tlData.map(p => p.display_val ?? 0);
  const tlMin = tlVals.length ? Math.min(...tlVals) : 0;
  const tlMax = tlVals.length ? Math.max(...tlVals) : 0;
  const yPad = Math.abs(tlMax - tlMin) * 0.1 || 1;

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
          Stats — <span style={{ color: 'var(--accent)' }}>{selectedPlayer}</span>
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <button
            onClick={handleRecalculate}
            disabled={recalcState === 'running'}
            style={{ padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: recalcState === 'running' ? 'not-allowed' : 'pointer', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            {recalcState === 'running' ? 'Recalculating…' : 'Recalculate Stats'}
          </button>
          {recalcMsg && (
            <span style={{ fontSize: '11px', color: recalcMsg.includes('Re-parsed') ? 'var(--info)' : 'var(--danger)' }}>{recalcMsg}</span>
          )}
        </div>
      </div>

      {/* Filters */}
      <FilterPanel filters={filters} onChange={setFilters} />

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px' }}>Loading stats…</div>
      )}

      {!loading && summary && (
        <>
          {/* Stat cards */}
          <SectionLabel>Overview{summary.total_hands > 0 && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '6px' }}>({summary.total_hands.toLocaleString()} hands)</span>}</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px', marginBottom: '32px' }}>
            {STAT_INFO.map(({ key, label, suffix, desc }) => {
              const val = summary[key] as number;
              const isWinRate = key === 'win_rate_bb_100';
              const isTotal = key === 'total_hands';
              const formatted = isTotal ? val.toLocaleString() : key === 'af' ? val.toFixed(2) : val.toFixed(1);
              const color = isWinRate ? (val >= 0 ? 'var(--info)' : 'var(--danger)') : 'var(--text-primary)';
              return (
                <div key={key} style={{ padding: '14px', borderRadius: '10px', background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '5px' }}>{label}</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color, lineHeight: 1 }}>
                    {formatted}
                    <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '2px' }}>{suffix}</span>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>{desc}</div>
                </div>
              );
            })}
          </div>

          {/* Win/Loss timeline */}
          {tlData.length > 1 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                <SectionLabel>Win / Loss Evolution</SectionLabel>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(['eur', 'bb'] as const).map(m => (
                    <button key={m} onClick={() => setTimelineMode(m)} style={{
                      padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      border: '1px solid var(--border)',
                      background: timelineMode === m ? 'var(--accent)' : 'var(--bg-elevated)',
                      color: timelineMode === m ? '#fff' : 'var(--text-secondary)',
                    }}>
                      {m === 'eur' ? '€' : 'bb'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ height: 240, marginBottom: '32px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={tlData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.4} />
                    <XAxis
                      dataKey="played_at"
                      tickFormatter={v => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      interval="preserveStartEnd"
                      minTickGap={40}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                      tickFormatter={v => timelineMode === 'eur' ? `€${v.toFixed(0)}` : `${v.toFixed(0)}bb`}
                      domain={[tlMin - yPad, tlMax + yPad]}
                      width={65}
                    />
                    <Tooltip content={(props) => <TimelineTooltip {...props} mode={timelineMode} />} />
                    <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 2" />
                    <Line
                      type="monotone"
                      dataKey="display_val"
                      dot={false}
                      strokeWidth={2}
                      stroke="var(--accent)"
                      activeDot={{ r: 4, fill: 'var(--accent)' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {/* Position breakdown */}
          {posStats.length > 0 && (
            <>
              <SectionLabel>Win Rate by Position (bb/100)</SectionLabel>
              <div style={{ height: 200, marginBottom: '28px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={posStats} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                    <XAxis dataKey="position" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                      formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(1)} bb/100`, 'Win Rate']}
                    />
                    <Bar dataKey="win_rate_bb_100" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <SectionLabel>Per-Position Stats</SectionLabel>
              <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '32px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
                      {['Position', 'Hands', 'VPIP', 'PFR', 'Win Rate'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {posStats.map((row, i) => (
                      <tr key={row.position} style={{ borderBottom: '1px solid var(--border-subtle)', background: i % 2 === 0 ? 'var(--bg-base)' : 'var(--bg-surface)' }}>
                        <td style={{ padding: '9px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>{row.position}</td>
                        <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>{row.hands}</td>
                        <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>{row.vpip_pct.toFixed(1)}%</td>
                        <td style={{ padding: '9px 14px', color: 'var(--text-secondary)' }}>{row.pfr_pct.toFixed(1)}%</td>
                        <td style={{ padding: '9px 14px', fontWeight: 700, color: row.win_rate_bb_100 >= 0 ? 'var(--info)' : 'var(--danger)' }}>
                          {row.win_rate_bb_100 >= 0 ? '+' : ''}{row.win_rate_bb_100.toFixed(1)} bb/100
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {posStats.length === 0 && summary.total_hands === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
              No hands match the current filters. Upload your PokerStars hand history in the Hands tab.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
      {children}
    </div>
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
