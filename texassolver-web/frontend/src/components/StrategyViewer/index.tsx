import { useState, useEffect } from 'react';
import { getJobResult } from '../../api/client';
import type { SolverNode, SolverActionNode, NavStep } from '../../types/solver';
import {
  getActionEntries, aggregateActions, actionColor, nodeChildren,
} from '../../lib/strategyUtils';
import { SUIT_SYMBOLS, SUIT_COLORS, type Suit } from '../../lib/poker';
import HandStrategyMatrix from './HandStrategyMatrix';
import ActionBreakdown from './ActionBreakdown';

interface Props {
  jobId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isActionNode(n: SolverNode): n is SolverActionNode {
  return n.node_type === 'action_node';
}

/** Format a card key like "Ac" → display with suit color/symbol */
function CardLabel({ card }: { card: string }) {
  if (card.length !== 2) return <span>{card}</span>;
  const rank = card[0];
  const suit = card[1] as Suit;
  const color = SUIT_COLORS[suit] ?? 'var(--text-primary)';
  const sym   = SUIT_SYMBOLS[suit] ?? suit;
  return (
    <span style={{ color, fontWeight: 700 }}>
      {rank}<span style={{ fontSize: '0.9em' }}>{sym}</span>
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StrategyViewer({ jobId }: Props) {
  const [tree, setTree]       = useState<SolverNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [path, setPath]       = useState<NavStep[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getJobResult(jobId)
      .then(data => {
        if (!cancelled) {
          setTree(data as SolverNode);
          setPath([]);
        }
      })
      .catch(e => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jobId]);

  if (loading) return <LoadingShell />;
  if (error)   return <ErrorShell message={error} />;
  if (!tree)   return null;

  const currentNode = path.length > 0 ? path[path.length - 1].node : tree;

  const navigateTo = (label: string, node: SolverNode) => {
    setPath(prev => [...prev, { label, node }]);
  };

  const navigateToBreadcrumb = (index: number) => {
    setPath(prev => prev.slice(0, index));
  };

  const children = nodeChildren(currentNode);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

      {/* ── Breadcrumb ── */}
      <nav style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        flexWrap: 'wrap', fontSize: '12px',
      }}>
        <BreadcrumbBtn label="ROOT" onClick={() => navigateToBreadcrumb(0)} isLast={path.length === 0} />
        {path.map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ color: 'var(--text-muted)' }}>›</span>
            <BreadcrumbBtn
              label={step.label}
              onClick={() => navigateToBreadcrumb(i + 1)}
              isLast={i === path.length - 1}
            />
          </div>
        ))}
      </nav>

      {/* ── Node type badge ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{
          padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700,
          background: currentNode.node_type === 'action_node' ? 'var(--accent-dim)' : 'rgba(88,166,255,0.12)',
          color: currentNode.node_type === 'action_node' ? 'var(--accent-text)' : 'var(--info)',
          border: `1px solid ${currentNode.node_type === 'action_node' ? 'var(--accent)' : 'var(--info)'}`,
        }}>
          {currentNode.node_type === 'action_node' ? 'Action Node' : 'Chance Node (Deal)'}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Depth {path.length} · {Object.keys(children).length} children
        </span>
      </div>

      {/* ── Action node: strategy + actions ── */}
      {isActionNode(currentNode) && (() => {
        const entries    = getActionEntries(currentNode);
        const aggregates = aggregateActions(currentNode, entries);

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Child action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                Available Actions
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {Object.entries(currentNode.childrens).map(([key, child]) => {
                  const agg = aggregates.find(a => a.name === key);
                  const color = actionColor(key);
                  return (
                    <button
                      key={key}
                      onClick={() => navigateTo(key, child)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 14px', borderRadius: '8px',
                        border: `1px solid ${color}40`,
                        background: `${color}14`,
                        color: 'var(--text-primary)',
                        cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${color}28`; e.currentTarget.style.borderColor = color; }}
                      onMouseLeave={e => { e.currentTarget.style.background = `${color}14`; e.currentTarget.style.borderColor = `${color}40`; }}
                    >
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                      {key}
                      {agg && <span style={{ color, fontFamily: 'monospace', fontSize: '11px' }}>{(agg.freq * 100).toFixed(0)}%</span>}
                    </button>
                  );
                })}
                {Object.keys(currentNode.childrens).length === 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Terminal node (no further children)
                  </span>
                )}
              </div>
            </div>

            {/* Strategy body: matrix + breakdown side-by-side */}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '24px', alignItems: 'start' }}>
              {/* 13×13 strategy matrix */}
              <div style={{ minWidth: 0 }}>
                <SectionLabel>Hand Strategy Matrix</SectionLabel>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Colored by dominant action · hover for details
                </div>
                <HandStrategyMatrix
                  strategy={currentNode.strategy.strategy}
                  entries={entries}
                />
              </div>

              {/* Right column: breakdown + legend */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {/* Action breakdown */}
                <div>
                  <SectionLabel>Range-wide Frequency</SectionLabel>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    Averaged across all combos in range
                  </div>
                  <ActionBreakdown aggregates={aggregates} />
                </div>

                {/* Color legend */}
                <div>
                  <SectionLabel>Action Legend</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '6px' }}>
                    {entries.map((e, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: 12, height: 12, borderRadius: '3px', background: actionColor(e.name), flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', flex: 1 }}>{e.name}</span>
                        <span style={{ fontSize: '11px', color: actionColor(e.name), fontFamily: 'monospace', fontWeight: 700 }}>
                          {((aggregates[i]?.freq ?? 0) * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Chance node: deal card selector ── */}
      {currentNode.node_type === 'chance_node' && (() => {
        const cards = Object.entries(children);
        if (cards.length === 0) {
          return (
            <EmptyShell message="No deal cards dumped at this depth. Re-run with dump_rounds set higher." />
          );
        }

        // Group by rank
        const byRank: Record<string, [string, SolverNode][]> = {};
        for (const [card, child] of cards) {
          const rank = card[0] ?? '?';
          if (!byRank[rank]) byRank[rank] = [];
          byRank[rank].push([card, child]);
        }

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Select a card to navigate to that runout ({cards.length} cards available)
            </div>
            {Object.entries(byRank).map(([rank, rankCards]) => (
              <div key={rank} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700, width: 16, textAlign: 'center' }}>{rank}</span>
                {rankCards.map(([card, child]) => {
                  const suit = card[1] as Suit;
                  const color = SUIT_COLORS[suit] ?? 'var(--text-primary)';
                  return (
                    <button
                      key={card}
                      onClick={() => navigateTo(card, child)}
                      style={{
                        width: 36, height: 48,
                        borderRadius: '6px',
                        border: `1px solid ${color}60`,
                        background: 'var(--bg-elevated)',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'all 0.12s',
                        gap: '1px',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.background = `${color}18`; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = `${color}60`; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
                    >
                      <CardLabel card={card} />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Helper sub-components ────────────────────────────────────────────────────

function BreadcrumbBtn({ label, onClick, isLast }: { label: string; onClick: () => void; isLast: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px', borderRadius: '5px',
        border: isLast ? '1px solid var(--accent)' : '1px solid transparent',
        background: isLast ? 'var(--accent-dim)' : 'transparent',
        color: isLast ? 'var(--accent-text)' : 'var(--text-secondary)',
        fontWeight: isLast ? 700 : 500,
        fontSize: '12px', cursor: isLast ? 'default' : 'pointer',
        fontFamily: 'monospace',
        transition: 'all 0.1s',
      }}
      onMouseEnter={e => { if (!isLast) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={e => { if (!isLast) e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '2px',
    }}>
      {children}
    </div>
  );
}

function LoadingShell() {
  return (
    <div style={{
      padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px',
    }}>
      <div style={{
        width: 32, height: 32, border: '3px solid var(--border)',
        borderTopColor: 'var(--accent)', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      Loading strategy…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ErrorShell({ message }: { message: string }) {
  return (
    <div style={{
      padding: '16px', borderRadius: '10px',
      background: 'rgba(248,81,73,0.08)', border: '1px solid var(--danger)',
      color: 'var(--danger)', fontSize: '13px',
    }}>
      {message}
    </div>
  );
}

function EmptyShell({ message }: { message: string }) {
  return (
    <div style={{
      padding: '24px', textAlign: 'center',
      color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic',
    }}>
      {message}
    </div>
  );
}
