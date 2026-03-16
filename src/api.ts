/**
 * Resolve the backend API base URL.
 *
 * - file:// protocol (packaged Electron app) → http://localhost:3000
 * - Vite dev server (http://localhost:5173)   → http://localhost:3000
 * - Any other origin (future web deploy)      → /api (relative)
 */
function resolveApiBase(): string {
  if (typeof window === "undefined") return "http://localhost:3000";

  const protocol = window.location.protocol;
  const hostname = window.location.hostname;

  if (protocol === "file:") {
    return "http://localhost:3000";
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:3000";
  }

  return "/api";
}

export const API_BASE = resolveApiBase();

// ─── Typed fetch wrapper ──────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({ error: res.statusText }));

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error ?? `HTTP ${res.status}`,
      data
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
