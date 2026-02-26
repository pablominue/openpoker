/** Preflop ranges API client */

export interface RangeEntry {
  scenario_key: string;
  scenario_label: string;
  category: string;
  range_str: string;
  is_default: boolean;
}

export interface DeviationRow {
  scenario_key: string;
  scenario_label: string;
  hands_played: number;
  in_range_count: number;
  adherence_pct: number;
}

export interface VillainPositionStat {
  position: string;
  total_hands: number;
  vpip: number;
  pfr: number;
  three_bet: number;
  vpip_pct: number;
  pfr_pct: number;
  three_bet_pct: number;
  estimated_range: string;
}

export interface VillainStatsResponse {
  villain_name: string;
  total_hands_sampled: number;
  positions: VillainPositionStat[];
}

async function _safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { detail: text }; }
}

export async function getRanges(playerName: string): Promise<RangeEntry[]> {
  const res = await fetch(`/api/ranges?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) throw new Error('Failed to load ranges');
  return res.json();
}

export async function saveRange(playerName: string, scenarioKey: string, rangeStr: string): Promise<RangeEntry> {
  const res = await fetch(
    `/api/ranges/${encodeURIComponent(scenarioKey)}?player_name=${encodeURIComponent(playerName)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ range_str: rangeStr }),
    }
  );
  if (!res.ok) {
    const err = await _safeJson(res) as { detail?: string };
    throw new Error(err.detail || `Save failed (${res.status})`);
  }
  return res.json();
}

export async function resetRange(playerName: string, scenarioKey: string): Promise<void> {
  await fetch(
    `/api/ranges/${encodeURIComponent(scenarioKey)}?player_name=${encodeURIComponent(playerName)}`,
    { method: 'DELETE' }
  );
}

export async function getDeviationStats(playerName: string): Promise<DeviationRow[]> {
  const res = await fetch(`/api/ranges/deviation?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) throw new Error('Failed to load deviation stats');
  return res.json();
}

export async function getVillainStats(villainName: string, playerName: string): Promise<VillainStatsResponse> {
  const res = await fetch(
    `/api/ranges/villain/${encodeURIComponent(villainName)}/stats?player_name=${encodeURIComponent(playerName)}`
  );
  if (!res.ok) throw new Error('Failed to load villain stats');
  return res.json();
}
