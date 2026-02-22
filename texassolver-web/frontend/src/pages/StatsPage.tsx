import { useState, useEffect } from 'react';
import { getStatsSummary, getStatsByPosition, reprocessHands } from '../api/hands';
import { usePlayer } from '../contexts/PlayerContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Summary {
  total_hands: number; vpip_pct: number; pfr_pct: number;
  three_bet_pct: number; wtsd_pct: number; win_rate_bb_100: number;
}
interface PosStats {
  position: string; hands: number; vpip_pct: number; pfr_pct: number; win_rate_bb_100: number;
}

const STAT_INFO: { key: keyof Summary; label: string; suffix: string; desc: string }[] = [
  { key: 'vpip_pct',       label: 'VPIP',      suffix: '%',    desc: 'Voluntarily put $ in pot' },
  { key: 'pfr_pct',        label: 'PFR',       suffix: '%',    desc: 'Preflop raise rate' },
  { key: 'three_bet_pct',  label: '3-Bet',     suffix: '%',    desc: '3-bet frequency' },
  { key: 'wtsd_pct',       label: 'WTSD',      suffix: '%',    desc: 'Went to showdown' },
  { key: 'win_rate_bb_100',label: 'Win Rate',  suffix: 'bb/100', desc: 'Net bb per 100 hands' },
  { key: 'total_hands',    label: 'Hands',     suffix: '',     desc: 'Total hands played' },
];

export default function StatsPage() {
  const { selectedPlayer } = usePlayer();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [posStats, setPosStats] = useState<PosStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recalcState, setRecalcState] = useState<'idle' | 'running' | 'done'>('idle');
  const [recalcMsg, setRecalcMsg] = useState<string | null>(null);

  const loadStats = (player: string) => {
    setSummary(null);
    setPosStats([]);
    setError(null);
    Promise.all([getStatsSummary(player), getStatsByPosition(player)])
      .then(([s, p]) => { setSummary(s); setPosStats(p); })
      .catch(e => setError(String(e)));
  };

  useEffect(() => {
    if (!selectedPlayer) return;
    loadStats(selectedPlayer);
  }, [selectedPlayer]);

  const handleRecalculate = async () => {
    if (!selectedPlayer || recalcState === 'running') return;
    setRecalcState('running');
    setRecalcMsg(null);
    try {
      const result = await reprocessHands(selectedPlayer);
      setRecalcMsg(`Re-parsed ${result.reprocessed} hands. Stats updated.`);
      loadStats(selectedPlayer);
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
        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
          Select a player to view stats
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
          Use the player selector in the top-right corner.
        </div>
      </div>
    );
  }

  if (error) return <ErrMsg msg={error} />;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-primary)' }}>
          Stats — <span style={{ color: 'var(--accent)' }}>{selectedPlayer}</span>
        </h1>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
          <button
            onClick={handleRecalculate}
            disabled={recalcState === 'running'}
            style={{
              padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: recalcState === 'running' ? 'not-allowed' : 'pointer',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
            }}
          >
            {recalcState === 'running' ? 'Recalculating…' : 'Recalculate Stats'}
          </button>
          {recalcMsg && (
            <span style={{ fontSize: '11px', color: recalcMsg.includes('Re-parsed') ? 'var(--info)' : 'var(--danger)' }}>
              {recalcMsg}
            </span>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '32px' }}>
        {STAT_INFO.map(({ key, label, suffix, desc }) => (
          <div key={key} style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '6px' }}>{label}</div>
            <div style={{ fontSize: '22px', fontWeight: 800, color: key === 'win_rate_bb_100' && summary ? (summary[key] >= 0 ? 'var(--info)' : 'var(--danger)') : 'var(--accent-text)', lineHeight: 1 }}>
              {summary ? (typeof summary[key] === 'number' && key !== 'total_hands' ? (summary[key] as number).toFixed(1) : summary[key]) : '—'}
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)', marginLeft: '2px' }}>{suffix}</span>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>{desc}</div>
          </div>
        ))}
      </div>

      {/* Position chart */}
      {posStats.length > 0 && (
        <>
          <SectionLabel>Win Rate by Position (bb/100)</SectionLabel>
          <div style={{ height: 200, marginBottom: '28px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={posStats} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.5} />
                <XAxis dataKey="position" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickFormatter={v => `${v}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number | undefined) => [`${(v ?? 0).toFixed(1)} bb/100`, 'Win Rate']}
                />
                <Bar dataKey="win_rate_bb_100" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <SectionLabel>Per-Position Stats</SectionLabel>
          <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border)' }}>
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

      {posStats.length === 0 && summary?.total_hands === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
          No hands yet. Upload your PokerStars hand history in the Hands tab.
        </div>
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

function ErrMsg({ msg }: { msg: string }) {
  return (
    <div style={{ maxWidth: 600, margin: '40px auto', padding: '16px', borderRadius: 10, background: 'rgba(248,81,73,0.08)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
      {msg}
    </div>
  );
}
