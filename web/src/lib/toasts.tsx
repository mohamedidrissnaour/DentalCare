import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon, notifIcon } from "../components/Icon";

interface Toast { id: number; kind: string; title: string; message?: string; link?: string }
interface Toasts { show: (kind: string, title: string, message?: string, link?: string) => void; success: (t: string, m?: string) => void; error: (t: string, m?: string) => void; warn: (t: string, m?: string) => void }
const Ctx = createContext<Toasts>(null!);
export const useToasts = () => useContext(Ctx);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const dismiss = (id: number) => setList((l) => l.filter((t) => t.id !== id));
  const show = useCallback((kind: string, title: string, message?: string, link?: string) => {
    const id = ++seq;
    setList((l) => [...l.slice(-4), { id, kind, title, message, link }]);
    setTimeout(() => dismiss(id), 6000);
  }, []);
  const value = useMemo(() => ({
    show, success: (t: string, m?: string) => show("success", t, m), error: (t: string, m?: string) => show("error", t, m), warn: (t: string, m?: string) => show("warning", t, m),
  }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind} slide-in`}>
            <span className="toast-ico"><Icon n={notifIcon(t.kind)} size={18} /></span>
            <div className="toast-body">
              <b>{t.title}</b>
              {t.message && <small>{t.message}</small>}
              {t.link && <Link to={t.link} className="toast-link" onClick={() => dismiss(t.id)}>Ouvrir →</Link>}
            </div>
            <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Fermer">✕</button>
            <span className="toast-timer"></span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
