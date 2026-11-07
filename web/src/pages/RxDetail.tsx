import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession, useLive } from "../lib/session";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { useToasts } from "../lib/toasts";
import { autoPrint } from "../lib/desktop";
import { Icon } from "../components/Icon";
import { Empty, PageHead, PageLoader } from "../components/ui";
import { RxPaper } from "../components/RxPaper";
import { dDate, dTime, dDayTime } from "../lib/format";
import { P, rxStatusLabel } from "../../../shared/domain";

const STEPS: [string, string, string][] = [["Brouillon", "Rédigée", "crayon"], ["Envoyee", "Envoyée", "envoyer"], ["Imprimee", "Imprimée", "imprimante"], ["Remise", "Remise", "coche"]];
const idx = (s: string) => ({ Brouillon: 0, Envoyee: 1, Imprimee: 2, Remise: 3 } as Record<string, number>)[s] ?? -1;

export function RxDetail() {
  const { id } = useParams();
  const { can, ref, refresh } = useSession();
  const toasts = useToasts();
  const nav = useNavigate();
  const d = useApi<any>(`/rx/${id}`, [id]);
  const [patient, setPatient] = useState<any>(null);
  useLive(["prescriptions"], () => d.reload());
  useEffect(() => {
    if (!d.data) return;
    api.get(`/patients/${d.data.rx.patientId}`).then(setPatient).catch(() => undefined);
    // Les notifications liées à cette ordonnance sont considérées comme lues.
    api.get("/notifications").then((l: any[]) => Promise.all(l.filter((n) => !n.readAt && n.entityId === d.data.rx.id && (n.kind === "ordonnance" || n.kind === "imprimee"))
      .map((n) => api.post("/notifications/read", { id: n.id })))).then(() => refresh()).catch(() => undefined);
  }, [d.data?.rx?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (d.error || (d.data === null && d.error)) return <Empty icon="ordonnance" title="Ordonnance introuvable"><Link className="btn btn-primary" to="/ordonnances">Retour</Link></Empty>;
  if (!d.data) return d.data === null && !d.error ? <PageLoader /> : <Empty icon="ordonnance" title="Ordonnance introuvable"><Link className="btn btn-primary" to="/ordonnances">Retour</Link></Empty>;
  const { rx, items } = d.data;
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toasts.success(ok); d.reload(); } catch (e: any) { toasts.error(e.message); } };
  const doctor = ref?.doctors.find((x) => x.id === rx.doctorId) ?? { fullName: rx.doctorName, role: "Docteur" };
  return (
    <>
      <PageHead title={rx.number} sub={<>Patient <Link to={`/patients/${rx.patientId}`}>{rx.patientName}</Link> · Dr {rx.doctorName} · {dDate(rx.createdAt)} {dTime(rx.createdAt)}</>}>
        {!!rx.urgent && <span className="chip chip-red">URGENT</span>}
        <span className={`status big rx-${rx.status.toLowerCase()}`}>{rxStatusLabel(rx.status)}</span>
      </PageHead>
      <div className="stepper">{STEPS.map(([st, label, icon]) => (
        <div key={st} className={"step" + (idx(st) <= idx(rx.status) ? " done" : "") + (st === rx.status ? " current" : "")}><i><Icon n={icon} /></i><span>{label}</span></div>
      ))}</div>
      <div className="rx-layout">
        <div className="card">
          <h3>Prescription</h3>
          <ol className="rx-items">{items.map((i: any) => (
            <li key={i.id}><b>{i.medication}</b><div>{i.dosage} {i.frequency} {i.duration ? "- " + i.duration : ""}</div>
              {i.quantity && <small>Quantité : {i.quantity}</small>}{i.instructions && <small>{i.instructions}</small>}</li>
          ))}</ol>
          {rx.notes && <p className="note"><Icon n="crayon" /> {rx.notes}</p>}
          {rx.printedAt && <p className="muted"><Icon n="imprimante" /> Imprimée le {dDayTime(rx.printedAt)} par {rx.printedByName} ({rx.printCount} fois)</p>}
          <div className="rx-actions">
            {rx.status === "Brouillon" && can(P.RxWrite) && <>
              <Link className="btn" to={`/ordonnances/${rx.id}/modifier`}><Icon n="crayon" /> Modifier</Link>
              <button className="btn btn-primary" onClick={() => act(() => api.post(`/rx/${rx.id}/send`), "Ordonnance envoyée au secrétariat")}><Icon n="envoyer" /> Envoyer au secrétariat</button>
            </>}
            {rx.status !== "Annulee" && can(P.RxPrint) && <>
              <a className="btn" href={`/impression/ordonnance/${rx.id}`} target="_blank" rel="noreferrer"><Icon n="oeil" /> Aperçu</a>
              <button className="btn btn-primary" onClick={async () => { await autoPrint(`/impression/ordonnance/${rx.id}?mark=1`); setTimeout(() => d.reload(), 1500); }}><Icon n="imprimante" /> Imprimer</button>
            </>}
            {rx.status === "Imprimee" && can(P.RxPrint) && <button className="btn" onClick={() => act(() => api.post(`/rx/${rx.id}/status`, { status: "Remise" }), "Remise au patient")}><Icon n="coche" /> Remise au patient</button>}
            {can(P.RxWrite) && <>
              <button className="btn" onClick={async () => { try { const r = await api.post(`/rx/${rx.id}/duplicate`); toasts.success("Copie créée (brouillon)"); nav(`/ordonnances/${r.id}/modifier`); } catch (e: any) { toasts.error(e.message); } }}><Icon n="copier" /> Renouveler</button>
              {rx.status !== "Annulee" && rx.status !== "Remise" && <button className="btn btn-danger-ghost" onClick={() => act(() => api.post(`/rx/${rx.id}/status`, { status: "Annulee" }), "Ordonnance annulée")}>✕ Annuler</button>}
            </>}
          </div>
        </div>
        <aside className="rx-preview">
          <div className="rx-preview-box"><RxPaper cabinet={ref?.settings ?? {}} doctor={doctor} patient={patient} date={rx.sentAt ?? rx.createdAt} items={items} notes={rx.notes} number={rx.number} mini /></div>
        </aside>
      </div>
    </>
  );
}
