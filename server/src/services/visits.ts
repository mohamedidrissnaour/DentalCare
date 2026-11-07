import { P, Roles, fmtDay, fmtDateTime, userTitle } from "../../../shared/domain";
import { BizError, Ctx } from "../security/context";
import { audit } from "../security/audit";
import { notifyUser, notifyRole } from "./core";
import { orderQueue, APPT_PRIORITY_WINDOW_MIN } from "./rules";
import { savePatient, type PatientInput } from "./patients";
import { bus } from "../obs/bus";
import { log } from "../obs/log";
import type { Db } from "../db/db";

/**
 * File d'attente du cabinet. Règles :
 *  - un patient arrivé (avec ou sans rendez-vous) reçoit un numéro de passage du jour ;
 *  - pas deux fois dans la file active le même jour ;
 *  - s'il a un rendez-vous aujourd'hui, celui-ci passe « En salle d'attente » ;
 *  - motif déclaré à l'accueil provisoire, corrigé par un praticien (diagnostic) ;
 *  - n'importe quel praticien peut appeler n'importe quel patient (celui qui appelle devient le praticien du passage).
 */
const SELECT = `
  SELECT v.*, p.last_name||' '||p.first_name AS patient_name, p.file_no, p.birth_date, p.phone, p.allergies,
         u.full_name AS doctor_name, u.color AS doctor_color, t.label AS appt_label, a.start_at AS appt_start,
         (SELECT COUNT(*) FROM visits x WHERE x.patient_id = v.patient_id)
           + (SELECT COUNT(*) FROM appointments ap WHERE ap.patient_id = v.patient_id AND ap.status = 'Termine'
              AND NOT EXISTS (SELECT 1 FROM visits y WHERE y.appointment_id = ap.id)) AS visit_count,
         (SELECT MAX(d) FROM (SELECT MAX(x.arrived_at) AS d FROM visits x WHERE x.patient_id = v.patient_id AND x.id <> v.id
                              UNION ALL SELECT MAX(ap.start_at) FROM appointments ap WHERE ap.patient_id = v.patient_id AND ap.status = 'Termine' AND ap.start_at < v.arrived_at)) AS last_visit,
         (SELECT COUNT(*) FROM treatment_plans pl WHERE pl.patient_id = v.patient_id AND pl.status = 'EnCours') AS open_plans,
         (SELECT IFNULL(SUM(tr.price), 0) FROM treatments tr WHERE tr.patient_id = v.patient_id) AS total_care,
         (SELECT IFNULL(SUM(pa.amount), 0) FROM payments pa JOIN invoices i ON i.id = pa.invoice_id WHERE i.patient_id = v.patient_id AND i.status <> 'Annulee') AS total_paid,
         (SELECT IFNULL(SUM(i.total - i.paid), 0) FROM invoices i WHERE i.patient_id = v.patient_id AND i.status IN ('Impayee','Partielle'))
           + (SELECT IFNULL(SUM(tr.price), 0) FROM treatments tr WHERE tr.patient_id = v.patient_id AND tr.invoice_id IS NULL) AS remaining
  FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN users u ON u.id = v.doctor_id
  LEFT JOIN appointments a ON a.id = v.appointment_id LEFT JOIN act_types t ON t.id = a.act_type_id`;

const today = () => fmtDay(new Date());
const changed = () => { bus.emit("visits"); bus.emit("appointments"); };

export function todayQueue(ctx: Ctx, day?: string) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : today();
  return orderQueue(ctx.db.query<any>(SELECT + " WHERE v.visit_day = @d", { d }), new Date());
}
export const getVisit = (ctx: Ctx, id: number) => ctx.db.first(SELECT + " WHERE v.id=@id", { id });
export const patientVisits = (ctx: Ctx, patientId: number) => ctx.db.query(SELECT + " WHERE v.patient_id=@patientId ORDER BY v.arrived_at DESC", { patientId });

/** Rendez-vous du jour pas encore arrivés : en retard ou attendus dans les 30 minutes. */
export function expectedAppointments(ctx: Ctx) {
  return ctx.db.query(`SELECT a.*, p.last_name||' '||p.first_name AS patient_name, p.phone AS patient_phone,
      u.full_name AS doctor_name, u.color AS doctor_color, t.label AS act_label, t.color AS act_color
    FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = a.doctor_id
    LEFT JOIN act_types t ON t.id = a.act_type_id
    WHERE a.start_at >= @today AND a.start_at < @soon AND a.status IN ('Planifie','Confirme')
      AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.appointment_id = a.id)
    ORDER BY a.start_at`, { today: today() + "T00:00:00", soon: new Date(Date.now() + 30 * 60000) });
}

export function registerArrival(ctx: Ctx, patientId: number, complaint: string | null | undefined, urgent: boolean, doctorId: number | null) {
  ctx.require(P.QueueManage);
  const c = complaint?.trim() || null;
  if ((c?.length ?? 0) > 300) throw new BizError("Motif : 300 caractères maximum.");
  const p = ctx.db.first<any>("SELECT id, archived, last_name, first_name FROM patients WHERE id=@patientId", { patientId });
  if (!p) throw new BizError("Patient introuvable.");
  if (p.archived) throw new BizError("Ce dossier est archivé : désarchivez-le avant d'enregistrer l'arrivée.");
  if (doctorId && !ctx.db.scalar("SELECT COUNT(*) FROM users WHERE id=@d AND role IN ('Principal','Docteur') AND status='Actif'", { d: doctorId })) throw new BizError("Praticien invalide.");
  const d = today();
  if (ctx.db.scalar("SELECT COUNT(*) FROM visits WHERE patient_id=@patientId AND visit_day=@d AND status IN ('EnAttente','EnConsultation')", { patientId, d }))
    throw new BizError("Ce patient est déjà dans la file d'attente.");
  const warnings: string[] = [];
  let doc = doctorId || null;
  const now = new Date();
  const id = ctx.db.tx(() => {
    const appt = ctx.db.first<any>(`SELECT * FROM appointments WHERE patient_id=@patientId AND start_at >= @from AND start_at < @to
        AND status IN ('Planifie','Confirme') ORDER BY start_at LIMIT 1`, { patientId, from: d + "T00:00:00", to: d + "T23:59:59" });
    if (appt) {
      ctx.db.run("UPDATE appointments SET status='Arrive', arrived_at=@now WHERE id=@id", { now, id: appt.id });
      doc = doc ?? appt.doctorId;
      const hh = appt.startAt.slice(11, 16);
      warnings.push(appt.startAt <= fmtDateTime(new Date(now.getTime() + APPT_PRIORITY_WINDOW_MIN * 60000))
        ? `Patient avec rendez-vous à ${hh} : il passe en priorité dans la file.`
        : `Rendez-vous de ${hh} associé : le patient passera en priorité à cette heure.`);
    }
    const no = ctx.db.scalar<number>("SELECT IFNULL(MAX(queue_no), 0) + 1 FROM visits WHERE visit_day=@d", { d })!;
    return ctx.db.run(`INSERT INTO visits(patient_id, visit_day, queue_no, arrived_at, status, priority, doctor_id, appointment_id, complaint, registered_by)
      VALUES(@patientId, @d, @no, @now, 'EnAttente', @prio, @doc, @apptId, @c, @uid)`,
      { patientId, d, no, now, prio: urgent ? 1 : 0, doc, apptId: appt?.id ?? null, c, uid: ctx.user.id }).lastId;
  });
  audit(ctx.db, ctx.user, "Arrivée patient (file d'attente)", "visit", id);
  const who = `${String(p.lastName).toUpperCase()} ${p.firstName}`;
  const n = { kind: "arrivee", title: urgent ? "Urgence en salle d'attente" : "Patient en salle d'attente", message: who + (c ? " - " + c : ""), link: "/file-attente", entityId: id, from: userTitle(ctx.user) };
  if (doc) notifyUser(ctx.db, doc, n); else { notifyRole(ctx.db, Roles.Principal, n); notifyRole(ctx.db, Roles.Docteur, n); }
  log.info("file", `Passage ${id} enregistré`);
  changed();
  return { id, warnings };
}

export function registerNewPatient(ctx: Ctx, p: PatientInput, complaint: string | null, urgent: boolean, doctorId: number | null) {
  const pid = savePatient(ctx, p);
  return registerArrival(ctx, pid, complaint, urgent, doctorId);
}

export function callVisit(ctx: Ctx, id: number) {
  ctx.require(P.QueueCall);
  const v = ctx.db.first<any>("SELECT * FROM visits WHERE id=@id", { id });
  if (!v) throw new BizError("Passage introuvable.");
  if (v.status !== "EnAttente") throw new BizError("Ce patient n'est plus en attente.");
  if (ctx.db.scalar("SELECT COUNT(*) FROM visits WHERE doctor_id=@uid AND status='EnConsultation' AND visit_day=@d", { uid: ctx.user.id, d: v.visitDay }))
    throw new BizError("Vous avez déjà un patient en consultation : terminez-la d'abord.");
  const now = new Date();
  ctx.db.tx(() => {
    ctx.db.run("UPDATE visits SET status='EnConsultation', doctor_id=@uid, called_at=@now, started_at=@now WHERE id=@id", { uid: ctx.user.id, now, id });
    if (v.appointmentId) ctx.db.run("UPDATE appointments SET status='EnCours' WHERE id=@a AND status IN ('Arrive','Confirme','Planifie')", { a: v.appointmentId });
  });
  audit(ctx.db, ctx.user, "Patient appelé en consultation", "visit", id);
  changed();
  return { id };
}

export function finishVisit(ctx: Ctx, id: number) {
  ctx.require(P.QueueCall);
  const v = ctx.db.first<any>("SELECT * FROM visits WHERE id=@id", { id });
  if (!v || v.status !== "EnConsultation") throw new BizError("Aucune consultation en cours pour ce passage.");
  ctx.db.tx(() => {
    ctx.db.run("UPDATE visits SET status='Termine', ended_at=@now WHERE id=@id", { now: new Date(), id });
    if (v.appointmentId) ctx.db.run("UPDATE appointments SET status='Termine' WHERE id=@a AND status='EnCours'", { a: v.appointmentId });
  });
  audit(ctx.db, ctx.user, "Consultation terminée", "visit", id);
  notifyRole(ctx.db, Roles.Secretaire, { kind: "fin", title: "Consultation terminée", message: "Le patient peut passer au secrétariat (règlement, rendez-vous).", link: "/file-attente", entityId: id, from: userTitle(ctx.user) });
  changed();
  return { id };
}

export function backToQueue(ctx: Ctx, id: number) {
  ctx.require(P.QueueCall);
  ctx.db.run("UPDATE visits SET status='EnAttente', started_at=NULL, called_at=NULL WHERE id=@id AND status='EnConsultation'", { id });
  audit(ctx.db, ctx.user, "Patient remis en attente", "visit", id);
  changed();
  return { id };
}

export function leaveQueue(ctx: Ctx, id: number, reason?: string) {
  ctx.require(P.QueueManage);
  const n = ctx.db.run("UPDATE visits SET status='Parti', ended_at=@now, notes=@reason WHERE id=@id AND status='EnAttente'", { now: new Date(), reason: reason?.trim().slice(0, 300) || null, id }).changes;
  if (!n) throw new BizError("Seul un patient en attente peut être retiré de la file.");
  audit(ctx.db, ctx.user, "Patient retiré de la file d'attente", "visit", id);
  changed();
  return { id };
}

export function updateComplaint(ctx: Ctx, id: number, complaint?: string) {
  ctx.require(P.QueueManage);
  if ((complaint?.length ?? 0) > 300) throw new BizError("Motif : 300 caractères maximum.");
  ctx.db.run("UPDATE visits SET complaint=@c WHERE id=@id", { c: complaint?.trim() || null, id });
  audit(ctx.db, ctx.user, "Motif déclaré modifié", "visit", id);
  changed();
  return { id };
}

export function updateDiagnosis(ctx: Ctx, id: number, diagnosis?: string) {
  ctx.require(P.QueueDiagnosis);
  if ((diagnosis?.length ?? 0) > 500) throw new BizError("Diagnostic : 500 caractères maximum.");
  ctx.db.run("UPDATE visits SET diagnosis=@d, diagnosis_by=@uid WHERE id=@id", { d: diagnosis?.trim() || null, uid: ctx.user.id, id });
  audit(ctx.db, ctx.user, "Motif corrigé par le praticien", "visit", id);
  changed();
  return { id };
}

export function setPriority(ctx: Ctx, id: number, urgent: boolean) {
  ctx.require(P.QueueManage);
  ctx.db.run("UPDATE visits SET priority=@p WHERE id=@id AND status='EnAttente'", { p: urgent ? 1 : 0, id });
  audit(ctx.db, ctx.user, urgent ? "Passage marqué urgent" : "Urgence retirée", "visit", id);
  changed();
  return { id };
}

export function assignDoctor(ctx: Ctx, id: number, doctorId: number | null) {
  ctx.require(P.QueueManage);
  if (doctorId && !ctx.db.scalar("SELECT COUNT(*) FROM users WHERE id=@d AND role IN ('Principal','Docteur') AND status='Actif'", { d: doctorId })) throw new BizError("Praticien invalide.");
  ctx.db.run("UPDATE visits SET doctor_id=@doctorId WHERE id=@id AND status='EnAttente'", { doctorId, id });
  audit(ctx.db, ctx.user, "Praticien du passage modifié", "visit", id);
  if (doctorId) notifyUser(ctx.db, doctorId, { kind: "arrivee", title: "Patient orienté vers vous", message: "Un patient en salle d'attente vous a été attribué.", link: "/file-attente", entityId: id, from: userTitle(ctx.user) });
  changed();
  return { id };
}

/** Depuis l'agenda : un rendez-vous marqué « arrivé » entre automatiquement dans la file. */
export function ensureVisitForAppointment(db: Db, a: any, userId: number) {
  const d = today();
  if (String(a.startAt).slice(0, 10) !== d) return;
  if (db.scalar("SELECT COUNT(*) FROM visits WHERE (appointment_id=@id OR patient_id=@p) AND visit_day=@d AND status IN ('EnAttente','EnConsultation')", { id: a.id, p: a.patientId, d })) return;
  const no = db.scalar<number>("SELECT IFNULL(MAX(queue_no), 0) + 1 FROM visits WHERE visit_day=@d", { d })!;
  db.run(`INSERT INTO visits(patient_id, visit_day, queue_no, arrived_at, status, priority, doctor_id, appointment_id, complaint, registered_by)
    VALUES(@p, @d, @no, @now, 'EnAttente', @prio, @doc, @id, @reason, @uid)`,
    { p: a.patientId, d, no, now: new Date(), prio: a.isUrgent ? 1 : 0, doc: a.doctorId, id: a.id, reason: a.reason ?? null, uid: userId });
}
