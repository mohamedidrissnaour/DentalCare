import { P, Roles, isDoctor, apptStatusLabel, parseDt, fmtDay, fmtDateTime, userTitle } from "../../../shared/domain";
import { BizError, Ctx } from "../security/context";
import { audit } from "../security/audit";
import { getSettings, openingRanges, notifyUser, notifyRole } from "./core";
import { checkAppointment, canTransition, isLateCancel, overlaps } from "./rules";
import { ensureVisitForAppointment } from "./visits";
import { bus } from "../obs/bus";
import { log } from "../obs/log";
import type { Db } from "../db/db";

export const APPT_SELECT = `
  SELECT a.*, p.last_name||' '||p.first_name AS patient_name, p.phone AS patient_phone,
         (p.allergies IS NOT NULL AND p.allergies<>'') AS patient_allergy,
         u.full_name AS doctor_name, u.color AS doctor_color, t.label AS act_label, t.color AS act_color
  FROM appointments a JOIN patients p ON p.id=a.patient_id JOIN users u ON u.id=a.doctor_id
  LEFT JOIN act_types t ON t.id=a.act_type_id`;

const fmtTime = (s: string) => s.slice(11, 16);
const dayLong = (d: Date) => d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

export const rangeAppointments = (ctx: Ctx, from: string, to: string, doctorId?: number | null) =>
  ctx.db.query(APPT_SELECT + " WHERE a.start_at >= @from AND a.start_at < @to AND (@doctorId IS NULL OR a.doctor_id=@doctorId) ORDER BY a.start_at",
    { from, to, doctorId: doctorId || null });
export const patientAppointments = (ctx: Ctx, patientId: number) => ctx.db.query(APPT_SELECT + " WHERE a.patient_id=@patientId ORDER BY a.start_at DESC", { patientId });
export const getAppointment = (ctx: Ctx, id: number) => ctx.db.first(APPT_SELECT + " WHERE a.id=@id", { id });
export const actTypes = (db: Db, onlyActive = true) => db.query("SELECT * FROM act_types WHERE (@a=0 OR active=1) ORDER BY label", { a: onlyActive });

export interface ApptInput { id?: number; patientId: number; doctorId: number; startAt: string; endAt: string; actTypeId?: number | null; reason?: string | null; notes?: string | null; isUrgent?: boolean }

export function checkAppt(ctx: Ctx, a: ApptInput) {
  const s = parseDt(a.startAt);
  if (!s) return { errors: ["Date ou heure invalide."], warnings: [] as string[] };
  const from = fmtDay(s) + "T00:00:00", to = fmtDay(new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1)) + "T00:00:00";
  const id = a.id ?? 0;
  const doctorBusy = ctx.db.query<any>("SELECT * FROM appointments WHERE doctor_id=@d AND start_at>=@from AND start_at<@to AND id<>@id", { d: a.doctorId, from, to, id });
  const patientBusy = ctx.db.query<any>("SELECT * FROM appointments WHERE patient_id=@p AND start_at>=@from AND start_at<@to AND id<>@id", { p: a.patientId, from, to, id });
  const r = checkAppointment(a, new Date(), openingRanges(ctx.db, s), doctorBusy, patientBusy, !id);
  const doctor = ctx.db.first<any>("SELECT role, status FROM users WHERE id=@id", { id: a.doctorId });
  if (!doctor || !isDoctor(doctor.role) || doctor.status !== "Actif") r.errors.push("Praticien invalide ou inactif.");
  const patient = ctx.db.first<any>("SELECT archived, no_show_count FROM patients WHERE id=@id", { id: a.patientId });
  if (!patient) r.errors.push("Patient introuvable.");
  else {
    if (patient.archived) r.errors.push("Ce dossier patient est archivé.");
    const th = getSettings(ctx.db).noShowAlertThreshold;
    if (patient.noShowCount >= th) r.warnings.push(`Attention : ce patient a ${patient.noShowCount} absences non excusées.`);
  }
  return r;
}

export function saveAppointment(ctx: Ctx, input: ApptInput) {
  ctx.require(P.AgendaEdit);
  const a: ApptInput = {
    id: Number(input.id) || 0, patientId: Number(input.patientId) || 0, doctorId: Number(input.doctorId) || 0,
    startAt: String(input.startAt ?? ""), endAt: String(input.endAt ?? ""), actTypeId: Number(input.actTypeId) || null,
    reason: input.reason?.trim() || null, notes: input.notes?.trim().slice(0, 1000) || null, isUrgent: !!input.isUrgent,
  };
  if ((a.reason?.length ?? 0) > 200) throw new BizError("Motif : 200 caractères maximum.");
  const r = checkAppt(ctx, a);
  if (r.errors.length) throw new BizError(r.errors.join(" "));
  if (!a.id) {
    a.id = ctx.db.run(`INSERT INTO appointments(patient_id,doctor_id,start_at,end_at,act_type_id,status,reason,notes,is_urgent,created_by,created_at)
      VALUES(@patientId,@doctorId,@startAt,@endAt,@actTypeId,'Planifie',@reason,@notes,@isUrgent,@uid,@now)`, { ...a, uid: ctx.user.id, now: new Date() }).lastId;
    audit(ctx.db, ctx.user, "Création rendez-vous", "appointment", a.id);
    if (a.doctorId !== ctx.user.id) {
      const s = parseDt(a.startAt)!;
      notifyUser(ctx.db, a.doctorId, { kind: "rdv", title: "Nouveau rendez-vous", message: `${dayLong(s)} à ${fmtTime(a.startAt)} ajouté à votre agenda.`, link: `/agenda?date=${fmtDay(s)}`, entityId: a.id, from: userTitle(ctx.user) });
    }
  } else {
    const ex = ctx.db.first<any>("SELECT status FROM appointments WHERE id=@id", { id: a.id });
    if (!ex) throw new BizError("Rendez-vous introuvable.");
    if (ex.status === "Termine" || ex.status === "Annule") throw new BizError("Un rendez-vous terminé ou annulé ne peut plus être modifié.");
    ctx.db.run(`UPDATE appointments SET patient_id=@patientId, doctor_id=@doctorId, start_at=@startAt, end_at=@endAt, act_type_id=@actTypeId,
      reason=@reason, notes=@notes, is_urgent=@isUrgent WHERE id=@id`, a);
    audit(ctx.db, ctx.user, "Modification rendez-vous", "appointment", a.id);
  }
  bus.emit("appointments");
  return { id: a.id, warnings: r.warnings };
}

export function changeApptStatus(ctx: Ctx, id: number, to: string, cancelReason?: string) {
  const a = ctx.db.first<any>(APPT_SELECT + " WHERE a.id=@id", { id });
  if (!a) throw new BizError("Rendez-vous introuvable.");
  if (!canTransition(a.status, to)) throw new BizError(`Passage de « ${apptStatusLabel(a.status)} » à « ${apptStatusLabel(to)} » non autorisé.`);
  if (to === "EnCours" || to === "Termine") { if (!ctx.can(P.AgendaConsult)) throw new BizError("Votre profil ne permet pas de démarrer ou terminer une consultation."); }
  else if (!ctx.can(P.AgendaEdit)) throw new BizError("Votre profil ne permet pas de modifier les rendez-vous.");
  if (to === "Annule" && !cancelReason?.trim()) throw new BizError("Le motif d'annulation est obligatoire.");
  const start = parseDt(a.startAt)!, now = new Date();
  if (to === "Absent" && start > now) throw new BizError("Un patient ne peut être déclaré absent qu'après l'heure du rendez-vous.");
  const late = to === "Annule" && isLateCancel(start, now, getSettings(ctx.db).lateCancelHours);
  ctx.db.tx(() => {
    ctx.db.run(`UPDATE appointments SET status=@to,
        cancel_reason=CASE WHEN @to='Annule' THEN @reason ELSE cancel_reason END,
        late_cancel=CASE WHEN @to='Annule' THEN @late ELSE late_cancel END,
        arrived_at=CASE WHEN @to='Arrive' THEN @now ELSE arrived_at END WHERE id=@id`,
      { to, reason: cancelReason?.trim().slice(0, 200) ?? null, late, now, id });
    if (to === "Absent") ctx.db.run("UPDATE patients SET no_show_count=no_show_count+1 WHERE id=@p", { p: a.patientId });
    if (a.status === "Absent" && to === "Planifie") ctx.db.run("UPDATE patients SET no_show_count=max(0,no_show_count-1) WHERE id=@p", { p: a.patientId });
    // Synchronisation avec la file d'attente.
    if (to === "Arrive") ensureVisitForAppointment(ctx.db, a, ctx.user.id);
    else if (to === "EnCours") ctx.db.run("UPDATE visits SET status='EnConsultation', doctor_id=@d, started_at=@now, called_at=@now WHERE appointment_id=@id AND status='EnAttente'", { d: a.doctorId, now, id });
    else if (to === "Termine") ctx.db.run("UPDATE visits SET status='Termine', ended_at=@now WHERE appointment_id=@id AND status IN ('EnAttente','EnConsultation')", { now, id });
    else if (to === "Annule" || to === "Absent") ctx.db.run("UPDATE visits SET status='Parti', ended_at=@now WHERE appointment_id=@id AND status='EnAttente'", { now, id });
  });
  audit(ctx.db, ctx.user, `Rendez-vous : ${apptStatusLabel(a.status)} → ${apptStatusLabel(to)}`, "appointment", id, late ? "annulation tardive" : undefined);
  if (to === "Arrive" && a.doctorId !== ctx.user.id)
    notifyUser(ctx.db, a.doctorId, { kind: "arrivee", title: "Patient en salle d'attente", message: `Votre patient de ${fmtTime(a.startAt)} est arrivé.`, link: "/file-attente", entityId: id, from: userTitle(ctx.user) });
  if (to === "Termine")
    notifyRole(ctx.db, Roles.Secretaire, { kind: "fin", title: "Consultation terminée", message: `Le patient du Dr ${a.doctorName} (${fmtTime(a.startAt)}) peut passer au secrétariat.`, link: "/facturation", entityId: id, from: userTitle(ctx.user) });
  log.info("agenda", `Rendez-vous ${id} : ${a.status} → ${to}`);
  bus.emit("appointments"); bus.emit("visits");
  return { id, warnings: late ? ["Annulation tardive enregistrée."] : [] };
}

/** Premiers créneaux libres d'un praticien (prise de rendez-vous rapide). */
export function freeSlots(ctx: Ctx, doctorId: number, fromDay: string, durationMin: number, max = 12): string[] {
  const res: string[] = [];
  const step = Math.max(5, getSettings(ctx.db).slotMinutes);
  const base = parseDt(fromDay) ?? new Date();
  const dur = Math.min(240, Math.max(10, durationMin || 30));
  for (let d = 0; d < 21 && res.length < max; d++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
    const ranges = openingRanges(ctx.db, day);
    if (!ranges.length) continue;
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const busy = ctx.db.query<any>("SELECT start_at, end_at FROM appointments WHERE doctor_id=@doctorId AND start_at>=@s AND start_at<@e AND status NOT IN ('Annule','Absent')",
      { doctorId, s: fmtDay(day) + "T00:00:00", e: fmtDay(next) + "T00:00:00" });
    for (const [f, t] of ranges) {
      for (let m = f; m + dur <= t && res.length < max; m += step) {
        const st = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
        if (st < new Date()) continue;
        const en = new Date(st.getTime() + dur * 60000);
        if (!busy.some((b) => overlaps(st, en, parseDt(b.startAt)!, parseDt(b.endAt)!))) res.push(fmtDateTime(st));
      }
    }
  }
  return res;
}
