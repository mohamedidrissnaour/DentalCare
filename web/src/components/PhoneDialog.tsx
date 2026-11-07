import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { copyText } from "../lib/desktop";

/** Fenêtre d'appel (effet verre) : affiche le numéro du patient à appeler. */
export function PhoneDialog({ open, onClose, name, phone, subtitle, children }: { open: boolean; onClose: () => void; name: string; phone?: string | null; subtitle?: string | null; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  const close = () => { setCopied(false); onClose(); };
  return (
    <>
      <div className="glass-backdrop" onClick={close}></div>
      <div className="glass-dialog" role="dialog" aria-modal="true" aria-label={`Appeler ${name}`}>
        <button type="button" className="glass-close" onClick={close} aria-label="Fermer"><Icon n="fermer" /></button>
        <span className="glass-phone-ico"><Icon n="telephone" size={28} /></span>
        <h3>{name}</h3>
        {subtitle && <p className="glass-sub">{subtitle}</p>}
        <a className="glass-number" href={`tel:${digits}`}>{phone}</a>
        <div className="glass-actions">
          <a className="btn btn-call" href={`tel:${digits}`}><Icon n="telephone" /> Appeler</a>
          <button type="button" className="btn" onClick={async () => { await copyText(phone ?? ""); setCopied(true); }}><Icon n="copier" /> {copied ? "Copié" : "Copier le numéro"}</button>
        </div>
        {children && <div className="glass-extra">{children}</div>}
      </div>
    </>
  );
}
