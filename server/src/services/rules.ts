// Règles de gestion pures (sans base), testées par --selftest.
import { apptIsActive, parseDt } from "../../../shared/domain";

export interface Check { errors: string[]; warnings: string[] }
export const MIN_DURATION = 10, MAX_DURATION = 240;

export const TRANSITIONS: Record<string, string[]> = {
  Planifie: ["Confirme", "Arrive", "Annule", "Absent"],
  Confirme: ["Arrive", "Annule", "Absent", "Planifie"],
  Arrive: ["EnCours", "Annule", "Confirme"],
  EnCours: ["Termine", "Arrive"],
  Termine: [],
  Annule: ["Planifie"],
  Absent: ["Planifie"],
};
export const canTransition = (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to);
export const overlaps = (aS: Date, aE: Date, bS: Date, bE: Date) => aS < bE && bS < aE;
const hm = (d: Date) => d.getHours() * 60 + d.getMinutes();
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const time = (d: Date) => hhmm(hm(d));

export interface ApptLike { patientId: number; doctorId: number; startAt: string; endAt: string; isUrgent?: boolean | number; status?: string }

export function checkAppointment(a: ApptLike, now: Date, opening: [number, number][], doctorBusy: ApptLike[], patientBusy: ApptLike[], isNew: boolean): Check {
  const r: Check = { errors: [], warnings: [] };
  const s = parseDt(a.startAt), e = parseDt(a.endAt);
  if (!(a.patientId > 0)) r.errors.push("Choisissez un patient.");
  if (!(a.doctorId > 0)) r.errors.push("Choisissez un praticien.");
  if (!s || !e) { r.errors.push("Date ou heure invalide."); return r; }
  const dur = (e.getTime() - s.getTime()) / 60000;
  if (e <= s) r.errors.push("L'heure de fin doit être après l'heure de début.");
  else if (dur < MIN_DURATION || dur > MAX_DURATION) r.errors.push(`Durée autorisée : ${MIN_DURATION} à ${MAX_DURATION} minutes.`);
  if (s.toDateString() !== e.toDateString()) r.errors.push("Un rendez-vous doit commencer et finir le même jour.");
  if (isNew && s.getTime() < now.getTime() - 5 * 60000) r.errors.push("Impossible de créer un rendez-vous dans le passé.");
  const inside = opening.some(([f, t]) => hm(s) >= f && hm(e) <= t);
  if (!a.isUrgent) {
    if (!opening.length) r.errors.push("Le cabinet est fermé ce jour-là.");
    else if (!inside) r.errors.push(`Le créneau est en dehors des horaires d'ouverture (${opening.map(([f, t]) => `${hhmm(f)}-${hhmm(t)}`).join(" / ")}).`);
  } else if (!inside) r.warnings.push("Urgence planifiée hors des horaires d'ouverture.");
  for (const b of doctorBusy) {
    const bs = parseDt(b.startAt)!, be = parseDt(b.endAt)!;
    if (apptIsActive(b.status ?? "") && overlaps(s, e, bs, be)) r.errors.push(`Le praticien a déjà un rendez-vous de ${time(bs)} à ${time(be)}.`);
  }
  for (const b of patientBusy) {
    const bs = parseDt(b.startAt)!, be = parseDt(b.endAt)!;
    if (apptIsActive(b.status ?? "") && overlaps(s, e, bs, be)) r.errors.push(`Le patient a déjà un rendez-vous de ${time(bs)} à ${time(be)}.`);
  }
  if (patientBusy.some((b) => apptIsActive(b.status ?? "")) && !r.errors.length) r.warnings.push("Le patient a déjà un autre rendez-vous ce jour-là.");
  return r;
}

/** Annulation tardive : moins de N heures avant le rendez-vous. */
export const isLateCancel = (start: Date, now: Date, hours: number) => start.getTime() - now.getTime() < hours * 3600000;

// ------------------------------------------------------------------ File d'attente
export const APPT_PRIORITY_WINDOW_MIN = 5;
export interface VisitLike { id: number; status: string; priority: number; arrivedAt: string; apptStart?: string | null; startedAt?: string | null; queueNo: number }

/**
 * Ordre de la file : patients en consultation, puis en attente (urgences d'abord ; un patient avec rendez-vous
 * passe devant les patients sans rendez-vous dès que son heure arrive), puis terminés.
 */
export function orderQueue<T extends VisitLike>(all: T[], now: Date): T[] {
  const limit = now.getTime() + APPT_PRIORITY_WINDOW_MIN * 60000;
  const due = (v: T) => { const a = parseDt(v.apptStart); return a && a.getTime() <= limit ? a.getTime() : null; };
  const inCare = all.filter((v) => v.status === "EnConsultation").sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  const waiting = all.filter((v) => v.status === "EnAttente").sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const da = due(a), db = due(b);
    if ((da === null) !== (db === null)) return da === null ? 1 : -1;
    if (da !== null && db !== null && da !== db) return da - db;
    return a.arrivedAt.localeCompare(b.arrivedAt);
  });
  const done = all.filter((v) => v.status === "Termine" || v.status === "Parti").sort((a, b) => b.queueNo - a.queueNo);
  return [...inCare, ...waiting, ...done];
}
