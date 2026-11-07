import { useState } from "react";
import { Link } from "react-router-dom";
import { Modal, Alerts } from "./ui";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { useToasts } from "../lib/toasts";
import { apptStatusCss, apptStatusLabel, parseDt } from "../../../shared/domain";
import { dLong, dTime } from "../lib/format";

const TRANSITIONS: Record<string, string[]> = {
  Planifie: ["Confirme", "Arrive", "Annule", "Absent"], Confirme: ["Arrive", "Annule", "Absent", "Planifie"],
  Arrive: ["EnCours", "Annule", "Confirme"], EnCours: ["Termine", "Arrive"], Termine: [], Annule: ["Planifie"], Absent: ["Planifie"],
};
const VERB: Record<string, string> = { Confirme: "Confirmer", Arrive: "Patient arrivé", EnCours: "Démarrer la consultation", Termine: "Terminer", Annule: "✕ Annuler le RDV", Absent: "Absent", Planifie: "↺ Replanifier" };

/** Fiche d'un rendez-vous + actions de workflow autorisées. */
export function AppointmentDetail({ appt, onClose, onEdit, onChanged, canConsult, canEdit, canRx }: { appt: any | null; onClose: () => void; onEdit: (a: any) => void; onChanged: () => void; canConsult: boolean; canEdit: boolean; canRx: boolean }) {
  const toasts = useToasts();
  const [err, setErr] = useState<string | null>(null);
  const [cancelMode, setCancelMode] = useState(false);
  const [reason, setReason] = useState("");
  const close = () => { setErr(null); setCancelMode(false); setReason(""); onClose(); };
  const go = async (to: string) => {
    if (to === "Annule" && !cancelMode) { setCancelMode(true); return; }
    try {
      const r = await api.post(`/appointments/${appt.id}/status`, { to, reason });
      r.warnings?.forEach((w: string) => toasts.warn(w));
      toasts.success(`Statut : ${apptStatusLabel(to)}`);
      onChanged(); close();
    } catch (e: any) { setErr(e.message); }
  };
  if (!appt) return null;
  const s = parseDt(appt.startAt)!, e = parseDt(appt.endAt)!;
  return (
    <Modal open onClose={close} title="Rendez-vous" footer={<>
      {canRx && <Link className="btn" to={`/ordonnances/nouvelle?patient=${appt.patientId}`}><Icon n="ordonnance" /> Ordonnance</Link>}
      <Link className="btn" to={`/patients/${appt.patientId}`}><Icon n="patients" /> Dossier</Link>
      {canEdit && appt.status !== "Termine" && appt.status !== "Annule" && <button className="btn btn-primary" onClick={() => onEdit(appt)}><Icon n="crayon" /> Modifier</button>}
    </>}>
      <div className="appt-detail">
        <div className="appt-head" style={{ ["--c" as any]: appt.actColor ?? appt.doctorColor }}>
          <div>
            <h3><Link to={`/patients/${appt.patientId}`}>{appt.patientName}</Link></h3>
            <p>{dLong(appt.startAt)} · <b>{dTime(appt.startAt)} – {dTime(appt.endAt)}</b> ({Math.round((e.getTime() - s.getTime()) / 60000)} min)</p>
            <p><Icon n="consultation" /> Dr {appt.doctorName} · {appt.actLabel ?? "Motif libre"} {appt.reason ? "- " + appt.reason : ""}</p>
            <p><Icon n="telephone" /> {appt.patientPhone}</p>
          </div>
          <span className={`status big ${apptStatusCss(appt.status)}`}>{apptStatusLabel(appt.status)}</span>
        </div>
        {!!appt.patientAllergy && <div className="alert alert-warn"><Icon n="alerte" /> Ce patient a une allergie déclarée : consultez son dossier.</div>}
        {!!appt.isUrgent && <div className="alert alert-error"><Icon n="alerte" /> Rendez-vous d'urgence</div>}
        {appt.notes && <p className="note"><Icon n="crayon" /> {appt.notes}</p>}
        {appt.status === "Annule" && <p className="note">Motif d'annulation : {appt.cancelReason} {appt.lateCancel ? "(annulation tardive)" : ""}</p>}
        {appt.arrivedAt && <p className="muted">Arrivé à {dTime(appt.arrivedAt)}</p>}
        {cancelMode && <label>Motif d'annulation<input value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={200} placeholder="Ex. patient malade, reporté…" autoFocus /></label>}
        <Alerts errors={err} />
        <div className="workflow">
          {(TRANSITIONS[appt.status] ?? []).filter((to) => (to === "EnCours" || to === "Termine" ? canConsult : canEdit)).map((to) => (
            <button key={to} className={`btn btn-step ${apptStatusCss(to)}`} onClick={() => go(to)}>{VERB[to]}</button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
