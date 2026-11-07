import fs from "node:fs";
import path from "node:path";
import { P, Roles, apptStatusLabel, fmtDay, fmtDateTime } from "../../../shared/domain";
import { BizError, Ctx } from "../security/context";
import { audit } from "../security/audit";
import { getSettings } from "./core";
import { log } from "../obs/log";
import type { Db } from "../db/db";

const D = (d: Date) => fmtDay(d) + "T00:00:00";
const monthShort = (d: Date) => d.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "");
const num = (v: unknown) => Number(v ?? 0) || 0;

export function dashboard(ctx: Ctx) {
  const doc = ctx.user.role === Roles.Docteur ? ctx.user.id : null;
  const t = new Date(); const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const month = new Date(today.getFullYear(), today.getMonth(), 1), monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const q = (sql: string, p: Record<string, unknown> = {}) => num(ctx.db.scalar(sql, { doc, today: D(today), tomorrow: D(tomorrow), month: D(month), monthEnd: D(monthEnd), ...p }));
  const colors: Record<string, string> = { Termine: "#1BAE7E", Confirme: "#14B1BB", Planifie: "#A5E4E8", Arrive: "#FCBF64", EnCours: "#14866A", Annule: "#D3D6DA", Absent: "#EA3747" };
  const byStatus = ctx.db.query<any>("SELECT status, COUNT(*) AS n FROM appointments WHERE start_at>=@month AND start_at<@monthEnd AND (@doc IS NULL OR doctor_id=@doc) GROUP BY status",
    { month: D(month), monthEnd: D(monthEnd), doc }).map((r) => ({ label: apptStatusLabel(r.status), value: r.n, color: colors[r.status] ?? "#ccc" }));
  const byAct = ctx.db.query<any>(`SELECT t.label, t.color, SUM(tr.price) AS total FROM treatments tr JOIN act_types t ON t.id=tr.act_type_id
      WHERE tr.performed_at>=@since AND (@doc IS NULL OR tr.doctor_id=@doc) GROUP BY t.id ORDER BY total DESC LIMIT 6`,
    { since: D(new Date(month.getFullYear(), month.getMonth() - 2, 1)), doc }).map((r) => ({ label: r.label, value: r.total, color: r.color }));
  const monday = new Date(today); monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const week = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i), e = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return { label: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }).replace(".", ""), value: q("SELECT COUNT(*) FROM appointments WHERE start_at>=@d AND start_at<@e AND status<>'Annule' AND (@doc IS NULL OR doctor_id=@doc)", { d: D(d), e: D(e) }) };
  });
  const revenue6M = Array.from({ length: 6 }, (_, k) => {
    const m = new Date(month.getFullYear(), month.getMonth() - (5 - k), 1), e = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    return { label: monthShort(m), value: q("SELECT SUM(amount) FROM payments WHERE paid_at>=@m AND paid_at<@e", { m: D(m), e: D(e) }) };
  });
  const revenue = ctx.can(P.StatsRevenue);
  return {
    todayTotal: q("SELECT COUNT(*) FROM appointments WHERE start_at>=@today AND start_at<@tomorrow AND status<>'Annule' AND (@doc IS NULL OR doctor_id=@doc)"),
    todayDone: q("SELECT COUNT(*) FROM appointments WHERE start_at>=@today AND start_at<@tomorrow AND status='Termine' AND (@doc IS NULL OR doctor_id=@doc)"),
    patientsTotal: q("SELECT COUNT(*) FROM patients WHERE archived=0"),
    newPatientsMonth: q("SELECT COUNT(*) FROM patients WHERE created_at>=@month"),
    revenueMonth: revenue ? q("SELECT SUM(price) FROM treatments WHERE performed_at>=@month AND (@doc IS NULL OR doctor_id=@doc)") : null,
    collectedMonth: revenue ? q("SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE p.paid_at>=@month AND (@doc IS NULL OR i.doctor_id=@doc)") : null,
    outstanding: revenue ? q("SELECT SUM(total-paid) FROM invoices WHERE status IN ('Impayee','Partielle') AND (@doc IS NULL OR doctor_id=@doc)") : null,
    rxToPrint: q("SELECT COUNT(*) FROM prescriptions WHERE status='Envoyee'"),
    byStatus, byAct: revenue ? byAct : [], week, revenue6M: revenue ? revenue6M : [],
    queue: queueToday(ctx.db),
  };
}

export function queueToday(db: Db) {
  const d = fmtDay(new Date());
  return {
    waiting: num(db.scalar("SELECT COUNT(*) FROM visits WHERE visit_day=@d AND status='EnAttente'", { d })),
    inCare: num(db.scalar("SELECT COUNT(*) FROM visits WHERE visit_day=@d AND status='EnConsultation'", { d })),
    done: num(db.scalar("SELECT COUNT(*) FROM visits WHERE visit_day=@d AND status='Termine'", { d })),
    avgWait: num(db.scalar("SELECT AVG((julianday(started_at)-julianday(arrived_at))*1440) FROM visits WHERE visit_day=@d AND started_at IS NOT NULL", { d })),
  };
}

/** Tableau de bord d'un patient : ce qu'il a généré, payé, ce qui reste, ses passages. */
export function patientSummary(ctx: Ctx, patientId: number) {
  const q = (sql: string, p: Record<string, unknown> = {}) => ctx.db.scalar(sql, { patientId, ...p });
  const unbilled = num(q("SELECT SUM(price) FROM treatments WHERE patient_id=@patientId AND invoice_id IS NULL"));
  return {
    totalCare: num(q("SELECT SUM(price) FROM treatments WHERE patient_id=@patientId")),
    invoiced: num(q("SELECT SUM(total) FROM invoices WHERE patient_id=@patientId AND status<>'Annulee'")),
    paid: num(q("SELECT SUM(p.amount) FROM payments p JOIN invoices i ON i.id=p.invoice_id WHERE i.patient_id=@patientId AND i.status<>'Annulee'")),
    unbilled,
    remaining: num(q("SELECT SUM(total-paid) FROM invoices WHERE patient_id=@patientId AND status IN ('Impayee','Partielle')")) + unbilled,
    visits: num(q(`SELECT (SELECT COUNT(*) FROM visits WHERE patient_id=@patientId)
      + (SELECT COUNT(*) FROM appointments ap WHERE ap.patient_id=@patientId AND ap.status='Termine' AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.appointment_id=ap.id))`)),
    appointments: num(q("SELECT COUNT(*) FROM appointments WHERE patient_id=@patientId")),
    noShows: num(q("SELECT COUNT(*) FROM appointments WHERE patient_id=@patientId AND status='Absent'")),
    openPlans: num(q("SELECT COUNT(*) FROM treatment_plans WHERE patient_id=@patientId AND status='EnCours'")),
    firstVisit: q("SELECT MIN(d) FROM (SELECT MIN(performed_at) AS d FROM treatments WHERE patient_id=@patientId UNION ALL SELECT MIN(arrived_at) FROM visits WHERE patient_id=@patientId)"),
    lastVisit: q("SELECT MAX(d) FROM (SELECT MAX(performed_at) AS d FROM treatments WHERE patient_id=@patientId UNION ALL SELECT MAX(arrived_at) FROM visits WHERE patient_id=@patientId)"),
    nextAppointment: q("SELECT MIN(start_at) FROM appointments WHERE patient_id=@patientId AND start_at>=@now AND status IN ('Planifie','Confirme')", { now: new Date() }),
  };
}

/** Indicateurs par praticien sur une période (tous avec « pilotage.all », sinon soi-même). */
export function doctorStats(ctx: Ctx, from: string, to: string) {
  ctx.require(P.PilotageOwn);
  const doctors = ctx.db.query<any>("SELECT * FROM users WHERE role IN ('Principal','Docteur') AND status='Actif' AND (@all=1 OR id=@me) ORDER BY role DESC, full_name",
    { all: ctx.can(P.PilotageAll), me: ctx.user.id });
  return doctors.map((d) => {
    const p = { id: d.id, from, to };
    const q = (sql: string) => num(ctx.db.scalar(sql, p));
    const appts = q("SELECT COUNT(*) FROM appointments WHERE doctor_id=@id AND start_at>=@from AND start_at<@to AND status<>'Annule'");
    const noShows = q("SELECT COUNT(*) FROM appointments WHERE doctor_id=@id AND start_at>=@from AND start_at<@to AND status='Absent'");
    const seen = q("SELECT COUNT(DISTINCT patient_id) FROM treatments WHERE doctor_id=@id AND performed_at>=@from AND performed_at<@to");
    const care = q("SELECT SUM(price) FROM treatments WHERE doctor_id=@id AND performed_at>=@from AND performed_at<@to");
    return {
      doctorId: d.id, name: d.fullName, color: d.color, role: d.role, appointments: appts, noShows, patientsSeen: seen,
      visits: q("SELECT COUNT(*) FROM visits WHERE doctor_id=@id AND arrived_at>=@from AND arrived_at<@to AND status='Termine'"),
      care, collected: q("SELECT SUM(pa.amount) FROM payments pa JOIN invoices i ON i.id=pa.invoice_id WHERE i.doctor_id=@id AND pa.paid_at>=@from AND pa.paid_at<@to"),
      openPlans: q("SELECT COUNT(*) FROM treatment_plans WHERE doctor_id=@id AND status='EnCours'"),
      avgWaitMin: q("SELECT AVG((julianday(started_at)-julianday(arrived_at))*1440) FROM visits WHERE doctor_id=@id AND started_at IS NOT NULL AND arrived_at>=@from AND arrived_at<@to"),
      avgTicket: seen ? Math.round((care / seen) * 100) / 100 : 0, noShowRate: appts ? Math.floor((noShows * 100) / appts) : 0,
    };
  });
}

export function debtors(ctx: Ctx, limit = 10) {
  ctx.require(P.PilotageAll);
  return ctx.db.query<any>(`SELECT p.id, p.last_name||' '||p.first_name AS name, p.phone,
      IFNULL((SELECT SUM(i.total-i.paid) FROM invoices i WHERE i.patient_id=p.id AND i.status IN ('Impayee','Partielle')),0)
    + IFNULL((SELECT SUM(t.price) FROM treatments t WHERE t.patient_id=p.id AND t.invoice_id IS NULL),0) AS due,
      (SELECT MAX(t.performed_at) FROM treatments t WHERE t.patient_id=p.id) AS last_care
    FROM patients p WHERE p.archived=0 ORDER BY due DESC LIMIT @limit`, { limit }).filter((r) => r.due > 0);
}

// ------------------------------------------------------------------ Référentiels
export function saveAct(ctx: Ctx, a: any) {
  ctx.requirePrincipal();
  const code = String(a.code ?? "").trim().toUpperCase(), label = String(a.label ?? "").trim();
  const dur = Number(a.durationMin), price = Number(a.price), id = Number(a.id) || 0;
  if (code.length < 2 || code.length > 8) throw new BizError("Code : 2 à 8 caractères.");
  if (label.length < 2 || label.length > 80) throw new BizError("Libellé : 2 à 80 caractères.");
  if (!Number.isInteger(dur) || dur < 5 || dur > 240) throw new BizError("Durée : 5 à 240 minutes.");
  if (!Number.isFinite(price) || price < 0 || price > 100000) throw new BizError("Tarif invalide.");
  const color = /^#[0-9a-fA-F]{6}$/.test(a.color ?? "") ? a.color : "#14B1BB";
  if (ctx.db.scalar("SELECT COUNT(*) FROM act_types WHERE code=@code AND id<>@id", { code, id })) throw new BizError("Ce code existe déjà.");
  const p = { code, label, dur, price, color, active: a.active !== false, id };
  const nid = id ? (ctx.db.run("UPDATE act_types SET code=@code,label=@label,duration_min=@dur,price=@price,color=@color,active=@active WHERE id=@id", p), id)
    : ctx.db.run("INSERT INTO act_types(code,label,duration_min,price,color,active) VALUES(@code,@label,@dur,@price,@color,@active)", p).lastId;
  audit(ctx.db, ctx.user, "Référentiel actes modifié", "act_type", nid);
  return { id: nid };
}
export function saveMedication(ctx: Ctx, m: any) {
  ctx.require(P.CatalogMeds);
  const name = String(m.name ?? "").trim(), id = Number(m.id) || 0;
  if (name.length < 2 || name.length > 120) throw new BizError("Nom : 2 à 120 caractères.");
  if (ctx.db.scalar("SELECT COUNT(*) FROM medications WHERE lower(name)=lower(@name) AND id<>@id", { name, id })) throw new BizError("Ce médicament existe déjà.");
  const c = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
  const p = { name, form: c(m.form), dd: c(m.defaultDosage), df: c(m.defaultFrequency), du: c(m.defaultDuration), notes: c(m.notes), active: m.active !== false, id };
  const nid = id ? (ctx.db.run("UPDATE medications SET name=@name,form=@form,default_dosage=@dd,default_frequency=@df,default_duration=@du,notes=@notes,active=@active WHERE id=@id", p), id)
    : ctx.db.run("INSERT INTO medications(name,form,default_dosage,default_frequency,default_duration,notes,active) VALUES(@name,@form,@dd,@df,@du,@notes,@active)", p).lastId;
  audit(ctx.db, ctx.user, "Référentiel médicaments modifié", "medication", nid);
  return { id: nid };
}

// ------------------------------------------------------------------ Sauvegardes (copie cohérente de la base, quotidienne + à la demande)
export class Backups {
  constructor(private db: Db, public folder: string) {}
  files() {
    if (!fs.existsSync(this.folder)) return [];
    return fs.readdirSync(this.folder).filter((f) => /^dentacare-\d{8}-\d{6}\.db$/.test(f)).map((f) => {
      const st = fs.statSync(path.join(this.folder, f));
      return { name: f, size: st.size, modified: fmtDateTime(st.mtime), mtime: st.mtimeMs };
    }).filter((f) => f.size > 0).sort((a, b) => b.mtime - a.mtime);
  }
  last() { return this.files()[0]?.modified ?? null; }
  now(reason: string) {
    fs.mkdirSync(this.folder, { recursive: true });
    const stamp = fmtDateTime(new Date()).replace(/[-:]/g, "").replace("T", "-");
    const file = path.join(this.folder, `dentacare-${stamp}.db`);
    this.db.backupTo(file);
    log.info("sauvegarde", `Sauvegarde réalisée (${reason}) : ${path.basename(file)} (${Math.round(fs.statSync(file).size / 1024)} Ko)`);
    this.purge();
    return path.basename(file);
  }
  private purge() {
    const keepDays = getSettings(this.db).backupRetentionDays;
    for (const f of this.files().slice(3)) if (f.mtime < Date.now() - keepDays * 86400000) try { fs.unlinkSync(path.join(this.folder, f.name)); } catch (e) { log.warn("sauvegarde", "Suppression impossible", e); }
  }
  /** Sauvegarde automatique si la dernière date de plus de 24 h (vérifié toutes les heures). */
  tick() {
    try { const l = this.files()[0]; if (!l || l.mtime < Date.now() - 24 * 3600000) this.now("automatique quotidienne"); }
    catch (e) { log.error("sauvegarde", "Échec de la sauvegarde automatique", e); }
  }
  filePath(name: string) {
    if (!/^dentacare-\d{8}-\d{6}\.db$/.test(name)) return null; // nom strict : pas de traversée de chemin
    const p = path.join(this.folder, name);
    return fs.existsSync(p) ? p : null;
  }
}
export function manualBackup(ctx: Ctx, b: Backups) {
  ctx.requirePrincipal();
  const f = b.now("manuelle");
  audit(ctx.db, ctx.user, "Sauvegarde manuelle", "backup", null, f);
  return f;
}
