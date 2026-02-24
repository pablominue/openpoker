async function _safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { detail: text }; }
}

export interface StatsFilters {
  position?: string;
  three_bet_pot?: boolean;
  date_from?: string;
  date_to?: string;
}

function _buildFilterParams(filters?: StatsFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters?.position) params.set('position', filters.position);
  if (filters?.three_bet_pot) params.set('three_bet_pot', 'true');
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);
  return params;
}

export async function uploadHands(file: File, playerName: string) {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api/hands/upload?player_name=${encodeURIComponent(playerName)}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const err = await _safeJson(res) as { detail?: string };
    throw new Error(err.detail || `Upload failed (${res.status})`);
  }
  return res.json() as Promise<{ parsed: number; skipped: number; duplicate: number }>;
}

export interface HandFilters {
  position?: string;
  three_bet_pot?: boolean;
  date_from?: string;
  date_to?: string;
  min_pot?: number;
  max_pot?: number;
}

export async function getHands(playerName: string, page = 1, perPage = 50, filters?: HandFilters) {
  const params = new URLSearchParams({
    player_name: playerName,
    page: String(page),
    per_page: String(perPage),
  });
  if (filters?.position) params.set('position', filters.position);
  if (filters?.three_bet_pot) params.set('three_bet_pot', 'true');
  if (filters?.date_from) params.set('date_from', filters.date_from);
  if (filters?.date_to) params.set('date_to', filters.date_to);
  if (filters?.min_pot != null) params.set('min_pot', String(filters.min_pot));
  if (filters?.max_pot != null) params.set('max_pot', String(filters.max_pot));
  const res = await fetch(`/api/hands?${params}`);
  if (!res.ok) throw new Error('Failed to load hands');
  return res.json();
}

export async function getHandDetail(id: string, playerName: string) {
  const res = await fetch(`/api/hands/${id}?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) throw new Error('Failed to load hand');
  return res.json();
}

export async function deleteHand(id: string, playerName: string) {
  const res = await fetch(`/api/hands/${id}?player_name=${encodeURIComponent(playerName)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete hand');
}

export async function getStatsSummary(playerName: string, filters?: StatsFilters) {
  const params = _buildFilterParams(filters);
  params.set('player_name', playerName);
  const res = await fetch(`/api/hands/stats/summary?${params}`);
  if (!res.ok) throw new Error('Failed to load stats');
  return res.json();
}

export async function getStatsByPosition(playerName: string, filters?: StatsFilters) {
  const params = _buildFilterParams(filters);
  params.set('player_name', playerName);
  const res = await fetch(`/api/hands/stats/by-position?${params}`);
  if (!res.ok) throw new Error('Failed to load position stats');
  return res.json();
}

export async function getStatsTimeline(playerName: string, filters?: StatsFilters) {
  const params = _buildFilterParams(filters);
  params.set('player_name', playerName);
  const res = await fetch(`/api/hands/stats/timeline?${params}`);
  if (!res.ok) throw new Error('Failed to load timeline');
  return res.json() as Promise<Array<{
    played_at: string;
    hand_id: string;
    result_cents: number;
    cumulative_cents: number;
    result_bb: number;
    cumulative_bb: number;
  }>>;
}

export interface GTOAction {
  name: string;
  gto_freq: number;
}

export interface GTODecision {
  street: string;
  hero_action: string;
  matched_solver_action: string | null;
  gto_actions: GTOAction[];
  hero_gto_freq: number;
  grade: string; // best | correct | inaccuracy | wrong | blunder
  range_strategy: Record<string, number[]> | null;
  action_entries: Array<{ name: string; index: number }>;
}

export interface GTOAnalysisResult {
  status: string; // "pending" | "solving" | "failed" | "ready"
  matched_spot_key: string | null;
  matched_spot_label: string | null;
  hero_combo: string | null;
  decisions: GTODecision[];
  note: string | null;
}

export async function getHandGTOAnalysis(handId: string, playerName: string): Promise<GTOAnalysisResult> {
  const res = await fetch(`/api/hands/${handId}/gto-analysis?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) throw new Error('Failed to load GTO analysis');
  return res.json();
}

export async function reprocessHands(playerName: string) {
  const res = await fetch(`/api/hands/reprocess?player_name=${encodeURIComponent(playerName)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reprocess hands');
  return res.json() as Promise<{ reprocessed: number }>;
}
