// Client HTTP de l'API DentaCare (même origine, cookie de session HttpOnly).
export class ApiError extends Error {
  constructor(message: string, public status: number, public data?: any) { super(message); }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch("/api" + url, {
    method, credentials: "same-origin",
    headers: { "X-DentaCare": "1", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith("/auth/")) window.dispatchEvent(new Event("dc:unauthorized"));
    if (res.status === 403 && data?.mustChange) window.dispatchEvent(new Event("dc:must-change"));
    throw new ApiError(data?.error ?? "Erreur de communication avec le serveur.", res.status, data);
  }
  return data as T;
}

export const api = {
  get: <T = any>(url: string) => call<T>("GET", url),
  post: <T = any>(url: string, body: unknown = {}) => call<T>("POST", url, body),
  put: <T = any>(url: string, body: unknown = {}) => call<T>("PUT", url, body),
  del: <T = any>(url: string) => call<T>("DELETE", url),
};

export const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? "?" + s : "";
};
