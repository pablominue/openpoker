async function _safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { detail: text }; }
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

export async function getHands(playerName: string, page = 1, perPage = 50, position?: string) {
  const params = new URLSearchParams({
    player_name: playerName,
    page: String(page),
    per_page: String(perPage),
  });
  if (position) params.set('position', position);
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

export async function getStatsSummary(playerName: string) {
  const res = await fetch(`/api/hands/stats/summary?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) throw new Error('Failed to load stats');
  return res.json();
}

export async function getStatsByPosition(playerName: string) {
  const res = await fetch(`/api/hands/stats/by-position?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) throw new Error('Failed to load position stats');
  return res.json();
}

export async function reprocessHands(playerName: string) {
  const res = await fetch(`/api/hands/reprocess?player_name=${encodeURIComponent(playerName)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reprocess hands');
  return res.json() as Promise<{ reprocessed: number }>;
}
