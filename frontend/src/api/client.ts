import type { JobStatusResponse, SolveRequest, SolveResponse } from '../types/solver';

const BASE = '/api';

export async function submitSolve(req: SolveRequest): Promise<SolveResponse> {
  const res = await fetch(`${BASE}/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`Submit failed: ${res.status}`);
  return res.json();
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  const res = await fetch(`${BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
  return res.json();
}

export async function getJobResult(jobId: string): Promise<unknown> {
  const res = await fetch(`${BASE}/jobs/${jobId}/result`);
  if (!res.ok) throw new Error(`Result fetch failed: ${res.status}`);
  return res.json();
}

export function createProgressSocket(jobId: string): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return new WebSocket(`${proto}://${location.host}/api/ws/${jobId}`);
}
