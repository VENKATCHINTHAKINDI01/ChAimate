// The FastAPI backend. Same origin in production (it hosts this static site);
// set NEXT_PUBLIC_API_BASE=http://localhost:8000 when running `next dev` on :3000.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { detail?: string }).detail || `Request failed (${r.status})`);
  return body as T;
}
