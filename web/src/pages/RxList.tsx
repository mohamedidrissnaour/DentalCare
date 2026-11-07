import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession, useLive } from "../lib/session";
import { useApi } from "../lib/hooks";
import { qs } from "../lib/api";
import { useToasts } from "../lib/toasts";
import { autoPrint } from "../lib/desktop";
import { Icon } from "../components/Icon";
import { PageHead, PageLoader } from "../components/ui";
import { ago, dDayTime } from "../lib/format";
import { P, rxStatusLabel } from "../../../shared/domain";

const FILTERS: [string | null, string][] = [[null, "Toutes"], ["Brouillon", "Brouillons"], ["Envoyee", "Envoyées"], ["Imprimee", "Imprimées"], ["Remise", "Remises"], ["Annulee", "Annulées"]];

export function RxList() {
  const { can } = useSession();
  const toasts = useToasts();
  const [status, setStatus] = useState<string | null>(null);
  const queue = useApi<any[]>("/rx/queue");
  const list = useApi<any[]>(`/rx${qs({ status })}`);
  useLive(["prescriptions"], () => { queue.reload(); list.reload(); });
  if (!queue.data || !list.data) return <PageLoader />;
  const toPrint = queue.data.filter((q) => q.status === "Envoyee");
  const print = async (r: any) => { await autoPrint(`/impression/ordonnance/${r.id}?mark=1`); toasts.success("Impression lancée", r.number); setTimeout(() => { queue.reload(); list.reload(); }, 1500); };
  return (
    <>
      <PageHead title="Ordonnances" sub={!can(P.RxWrite) ? "File d'impression en temps réel : les nouvelles ordonnances apparaissent automatiquement." : "Vos ordonnances et leur suivi."}>
        {can(P.RxWrite) && <Link className="btn btn-primary" to="/ordonnances/nouvelle"><Icon n="ordonnance" /> Nouvelle ordonnance</Link>}
      </PageHead>
      <section className="queue">
        <header><h3>À imprimer</h3><span className="count-pill">{toPrint.length}</span></header>
        <div className="queue-cards">
          {toPrint.map((r) => (
            <div key={r.id} className={"rx-card" + (r.urgent ? " urgent" : "")}>
              <div className="rx-card-top"><b>{r.number}</b>{!!r.urgent && <span className="chip chip-red">URGENT</span>}<em>{ago(r.sentAt ?? r.createdAt)}</em></div>
              <div className="rx-card-patient"><Icon n="utilisateur" /> {r.patientName}</div>
              <small>Dr {r.doctorName} · {r.itemCount} médicament(s)</small>
              <div className="rx-card-actions">
                <Link className="btn btn-sm" to={`/ordonnances/${r.id}`}><Icon n="oeil" /> Voir</Link>
                <button className="btn btn-sm btn-primary" disabled={!can(P.RxPrint)} onClick={() => print(r)}><Icon n="imprimante" /> Imprimer</button>
              </div>
            </div>
          ))}
          {!toPrint.length && <div className="queue-empty"><Icon n="valide" /> Rien à imprimer pour le moment.</div>}
        </div>
      </section>
      <div className="filters">{FILTERS.map(([k, l]) => <button key={l} className={"pill" + (status === k ? " on" : "")} onClick={() => setStatus(k)}>{l}</button>)}</div>
      <div className="card">
        <table className="table">
          <thead><tr><th>N°</th><th>Date</th><th>Patient</th><th>Praticien</th><th>Lignes</th><th>Statut</th><th>Imprimée</th><th></th></tr></thead>
          <tbody>
            {list.data.map((r) => (
              <tr key={r.id} className={r.urgent ? "row-urgent" : ""}>
                <td><Link to={`/ordonnances/${r.id}`}><b>{r.number}</b></Link></td><td>{dDayTime(r.createdAt)}</td>
                <td><Link to={`/patients/${r.patientId}`}>{r.patientName}</Link></td><td>Dr {r.doctorName}</td><td>{r.itemCount}</td>
                <td><span className={`status rx-${r.status.toLowerCase()}`}>{rxStatusLabel(r.status)}</span></td>
                <td>{r.printedAt ? `${dDayTime(r.printedAt)} · ${r.printedByName} (${r.printCount}×)` : "-"}</td>
                <td><Link className="link" to={`/ordonnances/${r.id}`}>Ouvrir →</Link></td>
              </tr>
            ))}
            {!list.data.length && <tr><td colSpan={8} className="center muted">Aucune ordonnance</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
