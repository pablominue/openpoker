/**
 * Utilities for working with the TexasSolver JSON output tree.
 * Handles: combo→matrix mapping, action name inference, color assignment,
 * per-cell aggregation, and log parsing.
 */

import { RANKS } from './poker';
import type {
  SolverActionNode,
  SolverNode,
  ActionEntry,
  ComboStrategy,
} from '../types/solver';

// ─── Rank index ───────────────────────────────────────────────────────────────

const RANK_IDX: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));

// ─── Combo → matrix cell ─────────────────────────────────────────────────────

/**
 * Map a 4-character combo string like "AhKs" → [row, col] in the 13×13 matrix.
 * Returns null if parsing fails.
 */
export function comboToCell(combo: string): [number, number] | null {
  if (combo.length !== 4) return null;
  const r1 = RANK_IDX[combo[0]];
  const r2 = RANK_IDX[combo[2]];
  if (r1 === undefined || r2 === undefined) return null;
  if (r1 === r2) return [r1, r2]; // pair

  const hi = Math.min(r1, r2); // smaller idx = higher rank
  const lo = Math.max(r1, r2);
  const suit1 = combo[1], suit2 = combo[3];

  if (suit1 === suit2) return [hi, lo]; // suited: row < col
  return [lo, hi];                       // offsuit: row > col
}

// ─── Action inference ─────────────────────────────────────────────────────────

/**
 * Given an action_node, derive the ordered list of action names that correspond
 * to each index in the strategy frequency array.
 *
 * Rule: if strategy_len === children_count + 1 → index 0 is FOLD.
 *       if strategy_len === children_count     → indices map 1:1 to children keys.
 */
export function getActionEntries(node: SolverActionNode): ActionEntry[] {
  const childKeys = Object.keys(node.childrens);
  const anyHand   = Object.values(node.strategy.strategy)[0] ?? [];
  const stratLen  = anyHand.length;

  if (stratLen === childKeys.length + 1) {
    return [
      { name: 'FOLD', index: 0 },
      ...childKeys.map((k, i) => ({ name: k, index: i + 1 })),
    ];
  }
  return childKeys.map((k, i) => ({ name: k, index: i }));
}

// ─── Action colors ────────────────────────────────────────────────────────────

const ACTION_PALETTE: [RegExp, string][] = [
  [/^FOLD$/i,              '#f85149'],
  [/^CHECK$/i,             '#7d8590'],
  [/^CALL$/i,              '#58a6ff'],
  [/^BET/i,                '#3fb950'],
  [/^RAISE/i,              '#d29922'],
  [/^ALLIN$/i,             '#bc8cff'],
];

export function actionColor(name: string): string {
  for (const [re, col] of ACTION_PALETTE) {
    if (re.test(name.trim())) return col;
  }
  return '#8b949e';
}

// ─── Aggregate strategy per matrix cell ───────────────────────────────────────

export interface CellAggregate {
  /** Average frequency per action index. */
  freqs: number[];
  /** Index of the dominant action (highest avg freq). */
  dominantIdx: number;
  /** Number of combos that hit this cell. */
  comboCount: number;
}

/**
 * Build a 13×13 grid where each cell contains the averaged strategy
 * frequencies across all combos that map to it.
 */
export function aggregateCells(
  strategy: ComboStrategy,
  actionCount: number,
): (CellAggregate | null)[][] {
  const grid: ({ sum: number[]; count: number } | null)[][] =
    Array.from({ length: 13 }, () => new Array(13).fill(null));

  for (const [combo, freqs] of Object.entries(strategy)) {
    if (freqs.length !== actionCount) continue;
    const cell = comboToCell(combo);
    if (!cell) continue;
    const [r, c] = cell;
    if (!grid[r][c]) grid[r][c] = { sum: new Array(actionCount).fill(0), count: 0 };
    const g = grid[r][c]!;
    freqs.forEach((f, i) => { g.sum[i] += f; });
    g.count++;
  }

  return grid.map(row =>
    row.map(cell => {
      if (!cell || cell.count === 0) return null;
      const freqs = cell.sum.map(s => s / cell.count);
      const dominantIdx = freqs.reduce((best, f, i) => f > freqs[best] ? i : best, 0);
      return { freqs, dominantIdx, comboCount: cell.count };
    }),
  );
}

// ─── Aggregate across all combos (for the breakdown bar) ─────────────────────

export interface ActionAggregate {
  name: string;
  color: string;
  /** Weighted average frequency 0–1 across all combos. */
  freq: number;
  index: number;
}

export function aggregateActions(
  node: SolverActionNode,
  entries: ActionEntry[],
): ActionAggregate[] {
  const strategy = node.strategy.strategy;
  const sums = new Array(entries.length).fill(0);
  let total = 0;

  for (const freqs of Object.values(strategy)) {
    if (freqs.length !== entries.length) continue;
    freqs.forEach((f, i) => { sums[i] += f; });
    total++;
  }

  return entries.map((e, i) => ({
    name: e.name,
    color: actionColor(e.name),
    freq: total > 0 ? sums[i] / total : 0,
    index: e.index,
  }));
}

// ─── Combo detail (hover tooltip) ────────────────────────────────────────────

export interface ComboDetail {
  combo: string;
  freqs: number[];
}

/** All combos in the strategy that belong to matrix cell (r, c). */
export function combosForCell(
  strategy: ComboStrategy,
  r: number,
  c: number,
): ComboDetail[] {
  return Object.entries(strategy)
    .filter(([combo]) => {
      const cell = comboToCell(combo);
      return cell && cell[0] === r && cell[1] === c;
    })
    .map(([combo, freqs]) => ({ combo, freqs }));
}

// ─── Exploitability log parsing ───────────────────────────────────────────────

export interface ExploitPoint {
  iter: number;
  exploitability: number;
}

/** Parse solver progress lines into (iteration, exploitability%) data points. */
export function parseExploitability(lines: string[]): ExploitPoint[] {
  const points: ExploitPoint[] = [];
  let currentIter = 0;

  for (const line of lines) {
    const iterMatch = line.match(/Iter:\s*(\d+)/);
    if (iterMatch) {
      currentIter = parseInt(iterMatch[1], 10);
      continue;
    }
    const exploitMatch = line.match(/Total exploitability\s+([\d.eE+\-]+)\s+precent/i);
    if (exploitMatch) {
      const val = parseFloat(exploitMatch[1]);
      if (!isNaN(val)) points.push({ iter: currentIter, exploitability: val });
    }
  }
  return points;
}

// ─── Tree navigation helpers ──────────────────────────────────────────────────

/** Safely get children of any node (unifies childrens + dealcards). */
export function nodeChildren(node: SolverNode): Record<string, SolverNode> {
  if (node.node_type === 'action_node') return node.childrens;
  return { ...node.dealcards, ...(node.childrens ?? {}) };
}
