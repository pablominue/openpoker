/** Poker domain utilities — hand matrix, range parsing and serialization. */

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;
export type Rank = typeof RANKS[number];

export const SUITS = ['s', 'h', 'd', 'c'] as const;
export type Suit = typeof SUITS[number];

export const SUIT_SYMBOLS: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_COLORS: Record<Suit, string> = {
  s: 'var(--card-spade)',
  h: 'var(--card-heart)',
  d: 'var(--card-diamond)',
  c: 'var(--card-club)',
};

/** A single card like "Ah", "Ks", "2c". */
export type Card = `${Rank}${Suit}`;

/** 13×13 matrix where [r][c] is the frequency (0–1) for that cell. */
export type RangeMatrix = number[][];

export function emptyMatrix(): RangeMatrix {
  return Array.from({ length: 13 }, () => new Array<number>(13).fill(0));
}

/**
 * Returns the canonical hand name for matrix cell (r, c):
 *   r === c → pair    (e.g. "AA")
 *   r < c   → suited  (e.g. "AKs")
 *   r > c   → offsuit (e.g. "AKo", higher rank written first)
 */
export function cellName(r: number, c: number): string {
  if (r === c) return `${RANKS[r]}${RANKS[c]}`;
  if (r < c)   return `${RANKS[r]}${RANKS[c]}s`;
  return `${RANKS[c]}${RANKS[r]}o`;
}

export function isPair(r: number, c: number) { return r === c; }
export function isSuited(r: number, c: number) { return r < c; }
export function isOffsuit(r: number, c: number) { return r > c; }

// ─── Range parsing ────────────────────────────────────────────────────────────

const RANK_IDX: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, i]));

function parseFreq(token: string): [string, number] {
  const colon = token.indexOf(':');
  if (colon === -1) return [token, 1.0];
  return [token.slice(0, colon), parseFloat(token.slice(colon + 1))];
}

/** Parse a solver range string into a 13×13 frequency matrix. */
export function parseRange(rangeStr: string): RangeMatrix {
  const mat = emptyMatrix();
  if (!rangeStr.trim()) return mat;

  const tokens = rangeStr.split(',').map(t => t.trim()).filter(Boolean);

  for (const token of tokens) {
    const [hand, freq] = parseFreq(token);

    // Pair range like AA-99
    const pairRange = hand.match(/^([AKQJT2-9])([AKQJT2-9])-([AKQJT2-9])([AKQJT2-9])$/);
    if (pairRange && pairRange[1] === pairRange[2] && pairRange[3] === pairRange[4]) {
      const from = RANK_IDX[pairRange[1]];
      const to   = RANK_IDX[pairRange[3]];
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) {
        mat[i][i] = freq;
      }
      continue;
    }

    // Suited connectors range like 87s-54s
    const suitedRange = hand.match(/^([AKQJT2-9])([AKQJT2-9])s-([AKQJT2-9])([AKQJT2-9])s$/);
    if (suitedRange) {
      const r1a = RANK_IDX[suitedRange[1]], r1b = RANK_IDX[suitedRange[2]];
      const r2a = RANK_IDX[suitedRange[3]]; void RANK_IDX[suitedRange[4]];
      const step = r1a < r2a ? 1 : -1;
      for (let i = r1a; i !== r2a + step; i += step) {
        const j = i + (r1b - r1a);
        if (j >= 0 && j < 13 && i < j) mat[i][j] = freq;
      }
      continue;
    }

    // Suited like AKs
    const suited = hand.match(/^([AKQJT2-9])([AKQJT2-9])s$/);
    if (suited) {
      const r = RANK_IDX[suited[1]], c = RANK_IDX[suited[2]];
      if (r !== undefined && c !== undefined && r < c) mat[r][c] = freq;
      continue;
    }

    // Offsuit like AKo
    const offsuit = hand.match(/^([AKQJT2-9])([AKQJT2-9])o$/);
    if (offsuit) {
      const r = RANK_IDX[offsuit[1]], c = RANK_IDX[offsuit[2]];
      if (r !== undefined && c !== undefined && r < c) mat[c][r] = freq;
      continue;
    }

    // Pair like AA
    const pair = hand.match(/^([AKQJT2-9])\1$/);
    if (pair) {
      const r = RANK_IDX[pair[1]];
      if (r !== undefined) mat[r][r] = freq;
      continue;
    }

    // Both suited+offsuit like AK
    const both = hand.match(/^([AKQJT2-9])([AKQJT2-9])$/);
    if (both && both[1] !== both[2]) {
      const r = RANK_IDX[both[1]], c = RANK_IDX[both[2]];
      if (r !== undefined && c !== undefined) {
        const lo = Math.min(r, c), hi = Math.max(r, c);
        mat[lo][hi] = freq; // suited
        mat[hi][lo] = freq; // offsuit
      }
      continue;
    }
  }

  return mat;
}

/** Serialize a 13×13 matrix back to a solver range string. */
export function serializeRange(mat: RangeMatrix): string {
  const parts: string[] = [];

  for (let r = 0; r < 13; r++) {
    for (let c = 0; c < 13; c++) {
      const freq = mat[r][c];
      if (freq === 0) continue;
      const name = cellName(r, c);
      parts.push(freq === 1 ? name : `${name}:${freq.toFixed(2)}`);
    }
  }

  return parts.join(',');
}

// ─── Board card utilities ─────────────────────────────────────────────────────

export function cardToSolverNotation(card: Card): string {
  return card; // already in the right format e.g. "Qs"
}

export function boardToSolverNotation(cards: Card[]): string {
  return cards.join(',');
}

export function allCards(): Card[] {
  const cards: Card[] = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      cards.push(`${rank}${suit}` as Card);
    }
  }
  return cards;
}

// ─── Frequency color ──────────────────────────────────────────────────────────

/**
 * Returns inline style for a range cell background based on frequency 0–1.
 * Uses CSS custom properties so it responds to theme changes.
 */
export function freqStyle(freq: number): React.CSSProperties {
  if (freq === 0) return { background: 'var(--range-empty)', color: 'var(--text-muted)' };
  if (freq >= 1)  return { background: 'var(--range-full)',  color: 'var(--bg-base)' };
  if (freq >= 0.5) return {
    background: `color-mix(in srgb, var(--range-full) ${Math.round(freq*100)}%, var(--range-mid))`,
    color: 'var(--bg-base)',
  };
  return {
    background: `color-mix(in srgb, var(--range-mid) ${Math.round(freq*200)}%, var(--range-empty))`,
    color: 'var(--text-primary)',
  };
}

// Need to import React for CSSProperties type
import type React from 'react';
