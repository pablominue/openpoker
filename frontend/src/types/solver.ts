export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface BetSizeConfig {
  position: 'ip' | 'oop';
  street: 'flop' | 'turn' | 'river';
  action: 'bet' | 'raise' | 'donk' | 'allin';
  sizes: number[];
}

export interface SolveRequest {
  pot: number;
  effective_stack: number;
  board: string;
  range_ip: string;
  range_oop: string;
  bet_sizes: BetSizeConfig[];
  allin_threshold?: number;
  thread_num?: number;
  accuracy?: number;
  max_iteration?: number;
  print_interval?: number;
  use_isomorphism?: boolean;
  dump_rounds?: number;
}

export interface SolveResponse {
  job_id: string;
  status: JobStatus;
}

export interface JobStatusResponse {
  job_id: string;
  status: JobStatus;
  progress: string[];
  error: string | null;
}

export interface WsMessage {
  line: string | null;
  status: JobStatus;
  error?: string | null;
}

// ─── Solver tree types ────────────────────────────────────────────────────────

/** Per-combo strategy: hand like "AhKs" → [freq_action0, freq_action1, ...] */
export type ComboStrategy = Record<string, number[]>;

export interface SolverStrategyWrapper {
  strategy: ComboStrategy;
}

export interface SolverActionNode {
  node_type: 'action_node';
  /** Action name → child node. Ordered; maps to strategy array positions (+ implicit FOLD at [0] if len > children). */
  childrens: Record<string, SolverNode>;
  strategy: SolverStrategyWrapper;
}

export interface SolverChanceNode {
  node_type: 'chance_node';
  /** Turn/river card name → subtree. TexasSolver uses "dealcards" (no underscore). */
  dealcards: Record<string, SolverNode>;
  deal_number: number;
  childrens?: Record<string, SolverNode>;
}

export type SolverNode = SolverActionNode | SolverChanceNode;

/** A step in the tree navigation breadcrumb. */
export interface NavStep {
  label: string;
  node: SolverNode;
}

/** Resolved action entry: name + frequency array index. */
export interface ActionEntry {
  name: string;
  index: number;
}
