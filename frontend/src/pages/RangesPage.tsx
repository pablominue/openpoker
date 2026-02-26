import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { getRanges, saveRange, resetRange, getVillainStats } from '../api/ranges';
import type { RangeEntry, VillainStatsResponse, VillainPositionStat } from '../api/ranges';
import RangeEditor from '../components/RangeEditor';
import { RANKS, cellName, parseRange, freqStyle } from '../lib/poker';

// ─── Scenario tree structure ───────────────────────────────────────────────

const CATEGORIES = ['Opens', 'vs EP', 'vs HJ', 'vs CO', 'vs BTN', 'vs SB'] as const;
type Category = typeof CATEGORIES[number];


// ─── Small read-only range matrix ─────────────────────────────────────────

function MiniRangeMatrix({ rangeStr }: { rangeStr: string }) {
  const mat = parseRange(rangeStr);
  return (
    <div style={{ display: 'inline-block' }}>
      {RANKS.map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 1 }}>
          {RANKS.map((_, c) => {
            const freq = mat[r][c];
            return (
              <div
                key={c}
                title={cellName(r, c)}
                style={{
                  width: 10, height: 10, borderRadius: 1,
                  ...freqStyle(freq),
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── Villain Range Panel ───────────────────────────────────────────────────

function VillainRangePanel({ playerName }: { playerName: string }) {
  const { players } = usePlayer();
  const [villainName, setVillainName] = useState('');
  const [customVillain, setCustomVillain] = useState('');
  const [stats, setStats] = useState<VillainStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPos, setSelectedPos] = useState<string | null>(null);

  const loadStats = useCallback(async (name: string) => {
    if (!name || !playerName) return;
    setLoading(true);
    setError(null);
    setStats(null);
    setSelectedPos(null);
    try {
      const data = await getVillainStats(name, playerName);
      setStats(data);
      if (data.positions.length > 0) setSelectedPos(data.positions[0].position);
    } catch {
      setError('Failed to load villain stats. Villain may not appear in hand history.');
    } finally {
      setLoading(false);
    }
  }, [playerName]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const name = customVillain.trim() || villainName;
    if (name) loadStats(name);
  };

  const selectedPosStat = stats?.positions.find(p => p.position === selectedPos);

  // Filter out the hero player from villain list
  const villainCandidates = players.filter(p => p !== playerName);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{
        padding: '16px', borderRadius: 10,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
      }}>
        <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Consult Villain Range</div>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
          Select a villain from your hand history to estimate their preflop ranges by position,
          based on their observed VPIP / PFR / 3-bet tendencies.
        </p>

        {/* Villain selector from known players */}
        {villainCandidates.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Known players
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {villainCandidates.map(p => (
                <button
                  key={p}
                  onClick={() => { setVillainName(p); loadStats(p); }}
                  style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    border: '1px solid var(--border)',
                    background: villainName === p ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                    color: villainName === p ? 'var(--accent-text)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Custom villain input */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            value={customVillain}
            onChange={e => setCustomVillain(e.target.value)}
            placeholder="Enter villain username…"
            style={{
              flex: 1, padding: '7px 10px', borderRadius: 7,
              border: '1px solid var(--border)', background: 'var(--bg-base)',
              color: 'var(--text-primary)', fontSize: 13, outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={loading || (!customVillain.trim() && !villainName)}
            style={{
              padding: '7px 14px', borderRadius: 7,
              background: 'var(--accent)', color: '#fff', border: 'none',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              opacity: (loading || (!customVillain.trim() && !villainName)) ? 0.5 : 1,
            }}
          >
            {loading ? 'Loading…' : 'Analyse'}
          </button>
        </form>

        {error && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: '#fee2e2', color: '#b91c1c', fontSize: 12 }}>
            {error}
          </div>
        )}
      </div>

      {stats && (
        <>
          {/* Summary header */}
          <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>{stats.villain_name}</span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--accent-dim)', color: 'var(--accent-text)', fontWeight: 600 }}>
                {stats.total_hands_sampled} hands sampled
              </span>
            </div>

            {stats.positions.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                No data found. Villain doesn't appear in the hand history.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>
                      {['Position', 'Hands', 'VPIP%', 'PFR%', '3-Bet%', ''].map((h, i) => (
                        <th key={i} style={{ padding: '6px 8px', textAlign: i === 0 ? 'left' : 'center', borderBottom: '1px solid var(--border)' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.positions.map(pos => (
                      <tr
                        key={pos.position}
                        onClick={() => setSelectedPos(pos.position)}
                        style={{
                          cursor: 'pointer',
                          background: selectedPos === pos.position ? 'var(--accent-dim)' : 'transparent',
                          transition: 'background 0.1s',
                        }}
                      >
                        <td style={{ padding: '8px', fontWeight: 700, color: selectedPos === pos.position ? 'var(--accent-text)' : 'var(--text-primary)' }}>
                          {pos.position}
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center', color: 'var(--text-secondary)' }}>{pos.total_hands}</td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          <StatBadge value={pos.vpip_pct} suffix="%" />
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          <StatBadge value={pos.pfr_pct} suffix="%" />
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          <StatBadge value={pos.three_bet_pct} suffix="%" />
                        </td>
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {selectedPos === pos.position ? '← viewing' : 'click'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Selected position range display */}
          {selectedPosStat && (
            <VillainPositionDetail stat={selectedPosStat} />
          )}
        </>
      )}
    </div>
  );
}

function StatBadge({ value, suffix }: { value: number; suffix: string }) {
  const color = value > 35 ? '#ef4444' : value > 20 ? '#f97316' : value > 10 ? '#eab308' : '#22c55e';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 6px', borderRadius: 999, fontSize: 11, fontWeight: 700,
      background: `${color}20`, color,
    }}>
      {value.toFixed(1)}{suffix}
    </span>
  );
}

function VillainPositionDetail({ stat }: { stat: VillainPositionStat }) {
  return (
    <div style={{ padding: '16px', borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>
        Estimated {stat.position} Range — based on {stat.vpip_pct.toFixed(1)}% VPIP
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Range Matrix
          </div>
          <MiniRangeMatrix rangeStr={stat.estimated_range} />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            Stats
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'VPIP', value: stat.vpip_pct, of: stat.total_hands },
              { label: 'PFR', value: stat.pfr_pct, of: stat.total_hands },
              { label: '3-Bet', value: stat.three_bet_pct, of: stat.total_hands },
              { label: 'Hands', value: stat.total_hands, isRaw: true },
            ].map(({ label, value, of, isRaw }) => (
              <div key={label} style={{ padding: '10px 12px', borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                  {isRaw ? value : `${value.toFixed(1)}%`}
                </div>
                {!isRaw && of && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{Math.round((value / 100) * of)}/{of} hands</div>
                )}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: '#fef3c7', border: '1px solid #fcd34d', fontSize: 11, color: '#92400e' }}>
            Range is estimated from VPIP stats. With showdown data, accuracy improves.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main RangesPage ───────────────────────────────────────────────────────

export default function RangesPage() {
  const { selectedPlayer } = usePlayer();
  const [tab, setTab] = useState<'my' | 'villain'>('my');
  const [ranges, setRanges] = useState<RangeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    Opens: true, 'vs EP': false, 'vs HJ': false, 'vs CO': false, 'vs BTN': false, 'vs SB': false,
  });
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const saveTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Load ranges whenever player changes
  useEffect(() => {
    if (!selectedPlayer) { setRanges([]); return; }
    setLoading(true);
    getRanges(selectedPlayer)
      .then(data => {
        setRanges(data);
        if (!selectedKey && data.length > 0) setSelectedKey(data[0].scenario_key);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedPlayer]);  // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = CATEGORIES.reduce<Record<Category, RangeEntry[]>>((acc, cat) => {
    acc[cat] = ranges.filter(r => r.category === cat);
    return acc;
  }, {} as Record<Category, RangeEntry[]>);

  const selectedRange = ranges.find(r => r.scenario_key === selectedKey);

  const handleRangeChange = useCallback((rangeStr: string) => {
    if (!selectedKey || !selectedPlayer) return;

    // Optimistic local update
    setRanges(prev => prev.map(r =>
      r.scenario_key === selectedKey ? { ...r, range_str: rangeStr, is_default: false } : r
    ));

    // Debounced save (500ms)
    if (saveTimerRef.current[selectedKey]) {
      clearTimeout(saveTimerRef.current[selectedKey]);
    }
    saveTimerRef.current[selectedKey] = setTimeout(async () => {
      setSavingKey(selectedKey);
      try {
        await saveRange(selectedPlayer, selectedKey, rangeStr);
        setSavedKeys(prev => new Set(prev).add(selectedKey));
        setTimeout(() => setSavedKeys(prev => { const s = new Set(prev); s.delete(selectedKey); return s; }), 2000);
      } catch {
        // Silently fail — user can try again
      } finally {
        setSavingKey(null);
      }
    }, 500);
  }, [selectedKey, selectedPlayer]);

  const handleReset = async () => {
    if (!selectedKey || !selectedPlayer) return;
    await resetRange(selectedPlayer, selectedKey);
    const fresh = await getRanges(selectedPlayer);
    setRanges(fresh);
  };

  const toggleCategory = (cat: string) => {
    setOpenCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  if (!selectedPlayer) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 24px', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>♟</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: 'var(--text-primary)' }}>Select a player</div>
        <div style={{ fontSize: 14 }}>Choose a player from the top-right menu to manage ranges.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Preflop Ranges</h1>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
          Manage {selectedPlayer}'s ranges for each scenario. Click a hand to toggle it, drag to paint, right-click to set partial frequency.
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {[
          { key: 'my', label: 'My Ranges' },
          { key: 'villain', label: 'Villain Ranges' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key as 'my' | 'villain')}
            style={{
              padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: tab === key ? 700 : 500,
              border: `1px solid ${tab === key ? 'var(--accent)' : 'var(--border)'}`,
              background: tab === key ? 'var(--accent-dim)' : 'var(--bg-elevated)',
              color: tab === key ? 'var(--accent-text)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'villain' ? (
        <VillainRangePanel playerName={selectedPlayer} />
      ) : (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          {/* ─── Sidebar ─── */}
          <div style={{
            width: 240, flexShrink: 0,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 12, overflow: 'hidden',
          }}>
            {loading && (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Loading ranges…
              </div>
            )}
            {CATEGORIES.map(cat => (
              <div key={cat}>
                {/* Category header */}
                <button
                  onClick={() => toggleCategory(cat)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', background: 'none', border: 'none',
                    cursor: 'pointer', textAlign: 'left',
                    borderTop: cat !== 'Opens' ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {cat}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.7 }}>
                    {openCategories[cat] ? '▾' : '▸'}
                  </span>
                </button>

                {/* Scenario items */}
                {openCategories[cat] && grouped[cat]?.map(entry => {
                  const isSelected = selectedKey === entry.scenario_key;
                  const isSaving = savingKey === entry.scenario_key;
                  const justSaved = savedKeys.has(entry.scenario_key);
                  return (
                    <button
                      key={entry.scenario_key}
                      onClick={() => setSelectedKey(entry.scenario_key)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 14px 8px 18px', background: isSelected ? 'var(--accent-dim)' : 'none',
                        border: 'none', cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span style={{
                        flex: 1, fontSize: 12, fontWeight: isSelected ? 700 : 400,
                        color: isSelected ? 'var(--accent-text)' : 'var(--text-primary)',
                      }}>
                        {entry.scenario_label}
                      </span>
                      {isSaving && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>saving…</span>}
                      {justSaved && <span style={{ fontSize: 9, color: '#22c55e' }}>✓</span>}
                      {entry.is_default && !isSaving && !justSaved && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', opacity: 0.6 }}>default</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* ─── Right panel ─── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {selectedRange ? (
              <RangeEditorPanel
                entry={selectedRange}
                onSave={handleRangeChange}
                onReset={handleReset}
                isSaving={savingKey === selectedRange.scenario_key}
                justSaved={savedKeys.has(selectedRange.scenario_key)}
              />
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                Select a scenario from the left panel.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Range Editor Panel ────────────────────────────────────────────────────

interface EditorPanelProps {
  entry: RangeEntry;
  onSave: (rangeStr: string) => void;
  onReset: () => void;
  isSaving: boolean;
  justSaved: boolean;
}

function RangeEditorPanel({ entry, onSave, onReset, isSaving, justSaved }: EditorPanelProps) {
  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 20,
    }}>
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{entry.scenario_label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {entry.scenario_key}
            {entry.is_default && (
              <span style={{ marginLeft: 8, padding: '1px 6px', borderRadius: 999, background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 10 }}>
                default range
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isSaving && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Saving…</span>}
          {justSaved && <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✓ Saved</span>}
          {!entry.is_default && (
            <button
              onClick={onReset}
              style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
                border: '1px solid var(--border)', background: 'var(--bg-elevated)',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              Reset to default
            </button>
          )}
        </div>
      </div>

      {/* The editor — auto-saves on change */}
      <RangeEditor
        label={entry.scenario_label}
        value={entry.range_str}
        onChange={onSave}
      />
    </div>
  );
}
