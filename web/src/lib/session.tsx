import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { useToasts } from "./toasts";
import { chime, autoPrint } from "./desktop";

export interface Me {
  id: number; username: string; fullName: string; role: string; color: string; autoPrint: boolean; mustChangePassword: boolean;
  email: string | null; phone: string | null; rpps: string | null; specialty: string | null;
}
export interface Ref { doctors: any[]; secretaries: any[]; actTypes: any[]; settings: any; paymentMethods: string[] }
interface Session {
  me: Me | null; loading: boolean; perms: Record<string, boolean>; can: (k: string) => boolean;
  unread: number; rxToPrint: number; queue: { waiting: number; inCare: number; done: number; avgWait: number }; cabinet: string;
  ref: Ref | null; refresh: () => Promise<void>; reloadRef: () => Promise<void>; logout: () => Promise<void>;
}
const Ctx = createContext<Session>(null!);
export const useSession = () => useContext(Ctx);

/** Abonnement aux événements temps réel (file d'attente, agenda, ordonnances…) : la page se recharge d'elle-même. */
export function useLive(topics: string[], fn: () => void) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    const h = () => ref.current();
    topics.forEach((t) => window.addEventListener("dc:" + t, h));
    return () => topics.forEach((t) => window.removeEventListener("dc:" + t, h));
  }, [topics.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState({ perms: {} as Record<string, boolean>, unread: 0, rxToPrint: 0, queue: { waiting: 0, inCare: 0, done: 0, avgWait: 0 }, cabinet: "" });
  const [ref, setRef] = useState<Ref | null>(null);
  const toasts = useToasts();
  const meRef = useRef<Me | null>(null); meRef.current = me;

  const refresh = useCallback(async () => {
    try {
      const r = await api.get("/me");
      setMe(r.user); setState({ perms: r.perms, unread: r.unread, rxToPrint: r.rxToPrint, queue: r.queue, cabinet: r.cabinet });
    } catch { setMe(null); }
    finally { setLoading(false); }
  }, []);
  const reloadRef = useCallback(async () => { try { setRef(await api.get("/ref")); } catch { /* hors session */ } }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (me && !me.mustChangePassword) reloadRef(); }, [me?.id, me?.mustChangePassword, reloadRef]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const h = () => setMe(null);
    window.addEventListener("dc:unauthorized", h);
    return () => window.removeEventListener("dc:unauthorized", h);
  }, []);

  // Flux temps réel.
  useEffect(() => {
    if (!me) return;
    const es = new EventSource("/api/events");
    const topics = ["visits", "appointments", "prescriptions", "notifications", "permissions", "users", "settings"];
    for (const t of topics) es.addEventListener(t, (ev) => {
      const data = JSON.parse((ev as MessageEvent).data || "{}");
      window.dispatchEvent(new CustomEvent("dc:" + t, { detail: data }));
      if (t === "notifications" && data.id) {
        toasts.show(data.kind, data.title, data.message, data.link ?? undefined);
        chime(data.kind);
        if (data.kind === "ordonnance" && meRef.current?.autoPrint && data.link) {
          const id = String(data.link).split("/").pop();
          if (id && /^\d+$/.test(id)) autoPrint(`/impression/ordonnance/${id}?mark=1`);
        }
      }
      if (t === "permissions" || t === "users" || t === "settings") { refresh(); reloadRef(); }
      if (t === "visits" || t === "prescriptions" || t === "notifications") refresh();
    });
    es.addEventListener("logout", () => { es.close(); setMe(null); });
    return () => es.close();
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const logout = useCallback(async () => { try { await api.post("/auth/logout"); } finally { setMe(null); } }, []);
  const value = useMemo<Session>(() => ({
    me, loading, ...state, can: (k: string) => !!state.perms[k], ref, refresh, reloadRef, logout,
  }), [me, loading, state, ref, refresh, reloadRef, logout]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
