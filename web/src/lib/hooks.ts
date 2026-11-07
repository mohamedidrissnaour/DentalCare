import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Charge une ressource de l'API ; `reload()` la recharge. `error` contient le message en cas d'échec (ex. accès refusé). */
export function useApi<T = any>(url: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const reload = useCallback(async () => {
    if (!url) return;
    try { setData(await api.get<T>(url)); setError(null); }
    catch (e: any) { setError({ message: e.message, status: e.status ?? 0 }); }
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload, setData };
}
