import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { Icon } from "../components/Icon";
import { Denied, PageHead, PageLoader } from "../components/ui";
import { PhoneDialog } from "../components/PhoneDialog";
import { money, dDate } from "../lib/format";
import { RecallKinds, recallLabel } from "../../../shared/domain";

const css = (k: string) => ({ absent: "chip-red", plan: "chip-blue", controle: "chip-green" } as Record<string, string>)[k] ?? "chip-amber";

export function Recalls() {
  const items = useApi<any[]>("/followup/recalls");
  const [kind, setKind] = useState<string | null>(null);
  const [sel, setSel] = useState<any>(null);
  if (items.error?.status === 403) return <><PageHead title="Patients à rappeler" /><Denied text="Votre profil ne peut pas gérer les rendez-vous." /></>;
  const all = items.data ?? [];
  const rows = all.filter((i) => !kind || i.kind === kind);
  return (
    <>
      <PageHead title="Patients à rappeler" sub="Absents sans nouveau rendez-vous, traitements en cours sans suite, contrôles à prévoir, restes à payer">
        <div className="seg">
          <button className={!kind ? "on" : ""} onClick={() => setKind(null)}>Tous ({all.length})</button>
          {RecallKinds.map(([k, l]) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{l} ({all.filter((i) => i.kind === k).length})</button>)}
        </div>
      </PageHead>
      {!items.data ? <PageLoader /> : (
        <div className="card flush"><table className="table">
          <thead><tr><th>Patient</th><th>Téléphone</th><th>Raison</th><th>Détail</th><th>Depuis</th><th className="num">Reste dû</th><th></th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.kind + r.patientId + i}>
                <td><Link className="link strong" to={`/patients/${r.patientId}`}>{r.patientName}</Link></td>
                <td><span className="status-with-action"><span className="num-l">{r.phone}</span><button className="phone-btn" title="Appeler" onClick={() => setSel(r)}><Icon n="telephone" /></button></span></td>
                <td><span className={`chip ${css(r.kind)}`}>{recallLabel(r.kind)}</span></td>
                <td>{r.detail}</td>
                <td className="num-l">{r.since ? dDate(r.since) : "-"}</td>
                <td className={"num " + (r.due > 0 ? "money-due" : "muted")}>{r.due > 0 ? money(r.due) : "-"}</td>
                <td><div className="row-actions">
                  {r.kind === "impaye" ? <Link className="btn btn-sm" to={`/facturation?patient=${r.patientId}`}><Icon n="euro" /> Encaisser</Link>
                    : <Link className="btn btn-sm" to={`/agenda?nouveau=1&patient=${r.patientId}`}><Icon n="calendrier" /> Rendez-vous</Link>}
                </div></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="muted center">Personne à rappeler. Tout est à jour.</td></tr>}
          </tbody>
        </table></div>
      )}
      <PhoneDialog open={!!sel} onClose={() => setSel(null)} name={sel?.patientName ?? ""} phone={sel?.phone} subtitle={sel ? `${recallLabel(sel.kind)} · ${sel.detail}` : null}>
        {sel && <>
          <Link className="btn btn-sm" to={`/patients/${sel.patientId}`}><Icon n="patients" /> Dossier</Link>
          <Link className="btn btn-sm btn-primary" to={`/agenda?nouveau=1&patient=${sel.patientId}`}><Icon n="calendrier" /> Fixer un rendez-vous</Link>
        </>}
      </PhoneDialog>
    </>
  );
}
