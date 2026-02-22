export async function getSpots() {
  const res = await fetch('/api/trainer/spots');
  if (!res.ok) throw new Error('Failed to load spots');
  return res.json();
}

export async function startSession(playerName: string, spot_id?: string) {
  const res = await fetch('/api/trainer/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ player_name: playerName, ...(spot_id ? { spot_id } : {}) }),
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = `Failed to start session (${res.status})`;
    try { detail = (JSON.parse(text) as { detail?: string }).detail || detail; } catch { /* use text */ }
    throw new Error(detail);
  }
  return res.json();
}

export async function submitAction(
  session_id: string,
  node_path: string[],
  chosen_action: string,
  pot_at_decision: number,
) {
  const res = await fetch(`/api/trainer/session/${session_id}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_path, chosen_action, pot_at_decision }),
  });
  if (!res.ok) throw new Error('Failed to submit action');
  return res.json();
}

export async function completeSession(session_id: string) {
  const res = await fetch(`/api/trainer/session/${session_id}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to complete session');
  return res.json();
}

export async function getSessions(playerName: string) {
  const res = await fetch(`/api/trainer/sessions?player_name=${encodeURIComponent(playerName)}`);
  if (!res.ok) throw new Error('Failed to load sessions');
  return res.json();
}
