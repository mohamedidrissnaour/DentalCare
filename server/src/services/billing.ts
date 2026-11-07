import { P, isDoctor, PaymentMethods, planStatusLabel, fmtDay, fmtDateTime, parseDt } from "../../../shared/domain";
import { BizError, Ctx } from "../security/context";
import { audit } from "../security/audit";
import { nextNumber } from "./core";
import { isValidTooth } from "./patients";
import { bus } from "../obs/bus";

/**
 * Soins réalisés et facturation. Règles :
 *  - soin attribué au praticien qui le saisit (une secrétaire autorisée désigne le praticien) ; prix ≥ 0 ; dent FDI ;
 *  - un soin facturé n'est plus modifiable ni supprimable ;
 *  - un paiement ne dépasse pas le reste dû ; statut de facture recalculé ;
 *  - une facture encaissée ne s'annule qu'avec la permission dédiée.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;
const activeDoctor = (ctx: Ctx, id: unknown) => !!ctx.db.scalar("SELECT COUNT(*) FROM users WHERE id=@id AND role IN ('Principal','Docteur') AND status='Actif'", { id: Number(id) || 0 });

export const patientTreatments = (ctx: Ctx, patientId: number) => ctx.db.query(`
  SELECT t.*, u.full_name AS doctor_name, pl.label AS plan_label, pl.sessions_planned AS plan_sessions
  FROM treatments t JOIN users u ON u.id=t.doctor_id LEFT JOIN treatment_plans pl ON pl.id=t.plan_id
  WHERE t.patient_id=@patientId ORDER BY t.performed_at DESC`, { patientId });

export interface TreatmentInput { patientId: number; doctorId?: number; actTypeId?: number | null; label: string; price: number; tooth?: number | null; notes?: string | null; planId?: number | null; performedAt?: string; appointmentId?: number | null }

export function addTreatment(ctx: Ctx, i: TreatmentInput) {
  ctx.require(P.CareEdit);
  const label = String(i.label ?? "").trim();
  const price = round2(Number(i.price));
  let tooth = i.tooth ? Number(i.tooth) : null;
  const patientId = Number(i.patientId) || 0;
  if (label.length < 2 || label.length > 120) throw new BizError("Libellé du soin : 2 à 120 caractères.");
  if (!Number.isFinite(price) || price < 0 || price > 100000) throw new BizError("Montant invalide.");
  if (tooth !== null && !isValidTooth(tooth)) throw new BizError("Numéro de dent invalide (notation FDI).");
  if (!ctx.db.scalar("SELECT COUNT(*) FROM patients WHERE id=@patientId AND archived=0", { patientId })) throw new BizError("Patient introuvable ou archivé.");
  let doctorId = Number(i.doctorId) || 0;
  if (isDoctor(ctx.user.role)) doctorId = ctx.user.id;
  else if (!activeDoctor(ctx, doctorId)) throw new BizError("Choisissez le praticien qui a réalisé le soin.");
  // Date seule : aujourd'hui = heure actuelle du serveur ; autre jour = midi (l'horloge du poste client n'est pas utilisée).
  const raw = String(i.performedAt ?? "");
  const performed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? (raw === fmtDay(new Date()) ? new Date() : new Date(+raw.slice(0, 4), +raw.slice(5, 7) - 1, +raw.slice(8, 10), 12))
    : parseDt(raw) ?? new Date();
  if (performed.getTime() > Date.now() + 5 * 60000) throw new BizError("Un soin ne peut pas être daté dans le futur.");
  let plan: any = null;
  if (i.planId) {
    plan = ctx.db.first("SELECT * FROM treatment_plans WHERE id=@pid AND patient_id=@patientId", { pid: Number(i.planId), patientId });
    if (!plan) throw new BizError("Plan de traitement introuvable pour ce patient.");
    if (plan.status !== "EnCours") throw new BizError("Ce plan de traitement est clôturé.");
    tooth = tooth ?? plan.tooth;
  }
  const visitId = ctx.db.scalar("SELECT id FROM visits WHERE patient_id=@patientId AND visit_day=@d AND status IN ('EnConsultation','Termine') ORDER BY id DESC LIMIT 1",
    { patientId, d: fmtDay(performed) });
  const warnings: string[] = [];
  let sessionNo: number | null = null;
  const id = ctx.db.tx(() => {
    if (plan) sessionNo = (ctx.db.scalar<number>("SELECT COUNT(*) FROM treatments WHERE plan_id=@id", { id: plan.id }) ?? 0) + 1;
    const nid = ctx.db.run(`INSERT INTO treatments(patient_id,doctor_id,appointment_id,performed_at,tooth,act_type_id,label,price,notes,plan_id,session_no,visit_id)
      VALUES(@patientId,@doctorId,@appointmentId,@performed,@tooth,@actTypeId,@label,@price,@notes,@planId,@sessionNo,@visitId)`, {
      patientId, doctorId, appointmentId: Number(i.appointmentId) || null, performed: fmtDateTime(performed), tooth, actTypeId: Number(i.actTypeId) || null,
      label, price, notes: i.notes?.trim().slice(0, 1000) || null, planId: plan?.id ?? null, sessionNo, visitId,
    }).lastId;
    if (plan && sessionNo! >= plan.sessionsPlanned) {
      ctx.db.run("UPDATE treatment_plans SET status='Termine', closed_at=@now WHERE id=@id", { now: new Date(), id: plan.id });
      warnings.push(`Dernière séance prévue : le plan « ${plan.label} » est terminé.`);
    }
    return nid;
  });
  audit(ctx.db, ctx.user, "Enregistrement d'un soin", "treatment", id, plan ? `plan=${plan.id} séance=${sessionNo}` : undefined);
  bus.emit("visits");
  return { id, warnings };
}

export function deleteTreatment(ctx: Ctx, id: number) {
  ctx.require(P.CareDelete);
  if (!ctx.db.run("DELETE FROM treatments WHERE id=@id AND invoice_id IS NULL", { id }).changes) throw new BizError("Ce soin est déjà facturé : suppression impossible.");
  audit(ctx.db, ctx.user, "Suppression d'un soin", "treatment", id);
  bus.emit("visits");
}

export const unbilled = (ctx: Ctx, patientId?: number | null) => ctx.db.query(`
  SELECT t.*, u.full_name AS doctor_name, p.last_name||' '||p.first_name AS patient_name
  FROM treatments t JOIN users u ON u.id=t.doctor_id JOIN patients p ON p.id=t.patient_id
  WHERE t.invoice_id IS NULL AND (@patientId IS NULL OR t.patient_id=@patientId) ORDER BY t.performed_at`, { patientId: patientId || null });

export function invoiceTreatments(ctx: Ctx, patientId: number, ids: number[]) {
  ctx.require(P.BillingCollect);
  const wanted = [...new Set((ids ?? []).map(Number).filter((n) => n > 0))];
  if (!wanted.length) throw new BizError("Sélectionnez au moins un soin.");
  const items = ctx.db.query<any>("SELECT * FROM treatments WHERE patient_id=@patientId AND invoice_id IS NULL", { patientId }).filter((t) => wanted.includes(t.id));
  if (items.length !== wanted.length) throw new BizError("Certains soins sont déjà facturés ou n'appartiennent pas à ce patient.");
  const total = round2(items.reduce((s, t) => s + t.price, 0));
  const id = ctx.db.tx(() => {
    const number = nextNumber(ctx.db, "F");
    const invId = ctx.db.run(`INSERT INTO invoices(number,patient_id,doctor_id,issued_at,total,paid,status,created_by)
      VALUES(@number,@patientId,@doctorId,@now,@total,0,@status,@uid)`,
      { number, patientId, doctorId: items[0].doctorId, now: new Date(), total, status: total === 0 ? "Payee" : "Impayee", uid: ctx.user.id }).lastId;
    for (const t of items) {
      ctx.db.run("INSERT INTO invoice_lines(invoice_id,label,tooth,qty,unit_price) VALUES(@inv,@label,@tooth,1,@price)", { inv: invId, label: t.label, tooth: t.tooth, price: t.price });
      ctx.db.run("UPDATE treatments SET invoice_id=@inv WHERE id=@id", { inv: invId, id: t.id });
    }
    return invId;
  });
  audit(ctx.db, ctx.user, "Création de facture", "invoice", id);
  bus.emit("visits");
  return { id };
}

const INV_SELECT = `SELECT i.*, p.last_name||' '||p.first_name AS patient_name, u.full_name AS doctor_name
  FROM invoices i JOIN patients p ON p.id=i.patient_id JOIN users u ON u.id=i.doctor_id`;
export const invoices = (ctx: Ctx, status?: string | null, patientId?: number | null, limit = 300) =>
  ctx.db.query(INV_SELECT + " WHERE (@status IS NULL OR i.status=@status) AND (@patientId IS NULL OR i.patient_id=@patientId) ORDER BY i.id DESC LIMIT @limit",
    { status: status || null, patientId: patientId || null, limit });
export function invoice(ctx: Ctx, id: number) {
  return {
    invoice: ctx.db.first(INV_SELECT + " WHERE i.id=@id", { id }) ?? null,
    lines: ctx.db.query("SELECT * FROM invoice_lines WHERE invoice_id=@id ORDER BY id", { id }),
    payments: ctx.db.query("SELECT p.*, u.full_name AS received_by_name FROM payments p JOIN users u ON u.id=p.received_by WHERE invoice_id=@id ORDER BY p.id", { id }),
  };
}

export function addPayment(ctx: Ctx, invoiceId: number, amountIn: number, method: string) {
  ctx.require(P.BillingCollect);
  if (!(PaymentMethods as readonly string[]).includes(method)) throw new BizError("Mode de paiement invalide.");
  const amount = round2(Number(amountIn));
  if (!Number.isFinite(amount) || amount <= 0) throw new BizError("Le montant doit être positif.");
  ctx.db.tx(() => {
    const inv = ctx.db.first<any>("SELECT * FROM invoices WHERE id=@invoiceId", { invoiceId });
    if (!inv) throw new BizError("Facture introuvable.");
    if (inv.status === "Annulee") throw new BizError("Facture annulée.");
    const remaining = round2(Math.max(0, inv.total - inv.paid));
    if (amount > remaining) throw new BizError(`Le montant dépasse le reste dû (${remaining.toFixed(2).replace(".", ",")} €).`);
    ctx.db.run("INSERT INTO payments(invoice_id,paid_at,amount,method,received_by) VALUES(@invoiceId,@now,@amount,@method,@uid)", { invoiceId, now: new Date(), amount, method, uid: ctx.user.id });
    const paid = round2(inv.paid + amount);
    ctx.db.run("UPDATE invoices SET paid=@paid, status=@status WHERE id=@invoiceId", { paid, status: paid >= inv.total ? "Payee" : "Partielle", invoiceId });
  });
  audit(ctx.db, ctx.user, "Encaissement", "invoice", invoiceId, `${amount.toFixed(2)} € ${method}`);
  bus.emit("visits");
  return { id: invoiceId };
}

export function cancelInvoice(ctx: Ctx, id: number) {
  ctx.require(P.BillingCollect);
  const inv = ctx.db.first<any>("SELECT * FROM invoices WHERE id=@id", { id });
  if (!inv) throw new BizError("Facture introuvable.");
  if (inv.paid > 0 && !ctx.can(P.BillingCancelPaid)) throw new BizError("Votre profil ne permet pas d'annuler une facture déjà encaissée.");
  ctx.db.tx(() => {
    ctx.db.run("UPDATE invoices SET status='Annulee' WHERE id=@id", { id });
    ctx.db.run("UPDATE treatments SET invoice_id=NULL WHERE invoice_id=@id", { id });
  });
  audit(ctx.db, ctx.user, "Annulation de facture", "invoice", id);
  bus.emit("visits");
}

// ------------------------------------------------------------------ Plans de traitement (plusieurs séances)
export const patientPlans = (ctx: Ctx, patientId: number) => ctx.db.query(`
  SELECT pl.*, u.full_name AS doctor_name,
         (SELECT COUNT(*) FROM treatments t WHERE t.plan_id = pl.id) AS sessions_done,
         (SELECT IFNULL(SUM(t.price), 0) FROM treatments t WHERE t.plan_id = pl.id) AS billed,
         (SELECT MAX(t.performed_at) FROM treatments t WHERE t.plan_id = pl.id) AS last_session
  FROM treatment_plans pl JOIN users u ON u.id = pl.doctor_id WHERE pl.patient_id = @patientId
  ORDER BY CASE pl.status WHEN 'EnCours' THEN 0 ELSE 1 END, pl.created_at DESC`, { patientId });

export interface PlanInput { patientId: number; doctorId?: number; tooth?: number | null; actTypeId?: number | null; label: string; sessionsPlanned: number; estimatedPrice: number; notes?: string | null }
export function createPlan(ctx: Ctx, p: PlanInput) {
  ctx.require(P.CareEdit);
  const label = String(p.label ?? "").trim(), sessions = Number(p.sessionsPlanned), est = round2(Number(p.estimatedPrice) || 0);
  const tooth = p.tooth ? Number(p.tooth) : null, patientId = Number(p.patientId) || 0;
  if (label.length < 2 || label.length > 120) throw new BizError("Libellé du plan : 2 à 120 caractères.");
  if (!Number.isInteger(sessions) || sessions < 1 || sessions > 30) throw new BizError("Nombre de séances : 1 à 30.");
  if (est < 0 || est > 100000) throw new BizError("Montant estimé invalide.");
  if (tooth !== null && !isValidTooth(tooth)) throw new BizError("Numéro de dent invalide (notation FDI).");
  if (!ctx.db.scalar("SELECT COUNT(*) FROM patients WHERE id=@patientId AND archived=0", { patientId })) throw new BizError("Patient introuvable ou archivé.");
  let doctorId = Number(p.doctorId) || 0;
  if (isDoctor(ctx.user.role)) doctorId = ctx.user.id;
  else if (!activeDoctor(ctx, doctorId)) throw new BizError("Choisissez le praticien responsable du traitement.");
  const id = ctx.db.run(`INSERT INTO treatment_plans(patient_id,doctor_id,tooth,act_type_id,label,sessions_planned,estimated_price,status,notes,created_at)
    VALUES(@patientId,@doctorId,@tooth,@actTypeId,@label,@sessions,@est,'EnCours',@notes,@now)`,
    { patientId, doctorId, tooth, actTypeId: Number(p.actTypeId) || null, label, sessions, est, notes: p.notes?.trim().slice(0, 500) || null, now: new Date() }).lastId;
  audit(ctx.db, ctx.user, "Création d'un plan de traitement", "plan", id);
  bus.emit("visits");
  return { id };
}
export function setPlanStatus(ctx: Ctx, planId: number, status: string) {
  ctx.require(P.CareEdit);
  if (!["EnCours", "Termine", "Abandonne"].includes(status)) throw new BizError("Statut invalide.");
  ctx.db.run("UPDATE treatment_plans SET status=@status, closed_at=CASE WHEN @status='EnCours' THEN NULL ELSE @now END WHERE id=@planId", { status, now: new Date(), planId });
  audit(ctx.db, ctx.user, `Plan de traitement : ${planStatusLabel(status)}`, "plan", planId);
  bus.emit("visits");
}

export const patientPayments = (ctx: Ctx, patientId: number) => ctx.db.query(`
  SELECT p.*, u.full_name AS received_by_name, i.number AS invoice_number
  FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN users u ON u.id = p.received_by
  WHERE i.patient_id = @patientId AND i.status <> 'Annulee' ORDER BY p.paid_at DESC`, { patientId });
