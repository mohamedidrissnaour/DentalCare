import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";

export function Loader({ text, small }: { text?: string; small?: boolean }) {
  return (
    <span className={"loader" + (small ? " loader-sm" : "")} role="status" aria-live="polite">
      <span className="loader-ring" aria-hidden="true"></span>
      {text && <span className="loader-text">{text}</span>}
    </span>
  );
}
export const PageLoader = ({ text }: { text?: string }) => <div className="page-loader"><Loader text={text} /></div>;

export function Modal({ open, onClose, title, wide, children, footer }: { open: boolean; onClose: () => void; title: string; wide?: boolean; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="modal-backdrop" onClick={onClose}></div>
      <div className={"modal" + (wide ? " modal-wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head"><h3>{title}</h3><button type="button" className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button></header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </>
  );
}

export function Alerts({ errors, warnings }: { errors?: string[] | string | null; warnings?: string[] | null }) {
  const e = typeof errors === "string" ? [errors] : errors ?? [];
  const w = warnings ?? [];
  if (!e.length && !w.length) return null;
  return (
    <div className="alerts">
      {e.map((x, i) => <div key={"e" + i} className="alert alert-error"><Icon n="erreur" /> {x}</div>)}
      {w.map((x, i) => <div key={"w" + i} className="alert alert-warn"><Icon n="alerte" /> {x}</div>)}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon n={icon} size={28} /></div><h2>{title}</h2>{children}</div>;
}
export const Denied = ({ text }: { text?: string }) => <Empty icon="cadenas" title="Accès refusé"><p>{text ?? "Votre profil n'a pas accès à cette page."}</p></Empty>;

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  useEffect(() => { document.title = `${title} - DentaCare`; }, [title]);
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      {children && <div className="toolbar">{children}</div>}
    </div>
  );
}
