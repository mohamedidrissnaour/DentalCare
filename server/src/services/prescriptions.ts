import { P, Roles, rxStatusLabel, fmtDay, userTitle } from "../../../shared/domain";
import { BizError, Ctx } from "../security/context";
import { audit } from "../security/audit";
import { nextNumber, notifyUser, notifyRole, markEntityRead } from "./core";
import { metrics } from "../obs/metrics";
import { bus } from "../obs/bus";
import { log } from "../obs/log";

/**
 * Ordonnances : le praticien rédige, envoie au secrétariat (notification temps réel) → impression → remise.
 * Règles : seul un praticien rédige ; 1 à 15 lignes ; une ordonnance envoyée n'est plus modifiable ;
 * alerte (non bloquante) si allergie déclarée ; chaque impression est tracée.
 */
export { MAX_ITEMS, validateRx, type RxItem } from "../../../shared/rx";
import { MAX_ITEMS, validateRx, clean, type RxItem } from "../../../shared/rx";

const SELECT = `SELECT r.*, p.last_name||' '||p.first_name AS patient_name, u.full_name AS doctor_name, pb.full_name AS printed_by_name,
    (SELECT COUNT(*) FROM prescription_items i WHERE i.prescription_id=r.id) AS item_count
  FROM prescriptions r JOIN patients p ON p.id=r.patient_id JOIN users u ON u.id=r.doctor_id LEFT JOIN users pb ON pb.id=r.printed_by`;

export const medications = (ctx: Ctx, all = false) => ctx.db.query("SELECT * FROM medications WHERE (@all=1 OR active=1) ORDER BY name", { all });
export const templates = (ctx: Ctx) => ctx.db.query<any>("SELECT * FROM rx_templates ORDER BY name").map((t) => ({ ...t, items: JSON.parse(t.itemsJson) }));

export function listRx(ctx: Ctx, status?: string | null, patientId?: number | null, limit = 200) {
  const doctorId = ctx.can(P.RxViewAll) ? null : ctx.user.id; // sinon : ses propres ordonnances (sauf depuis un dossier patient)
  return ctx.db.query(SELECT + ` WHERE (@status IS NULL OR r.status=@status) AND (@patientId IS NULL OR r.patient_id=@patientId)
      AND (@doctorId IS NULL OR r.doctor_id=@doctorId OR @patientId IS NOT NULL)
      AND (r.status <> 'Brouillon' OR r.doctor_id=@me)
    ORDER BY r.id DESC LIMIT @limit`, { status: status || null, patientId: patientId || null, doctorId, me: ctx.user.id, limit });
}
export const printQueue = (ctx: Ctx) => ctx.db.query(SELECT + " WHERE r.status IN ('Envoyee','Imprimee') AND r.created_at >= @since ORDER BY r.urgent DESC, r.sent_at",
  { since: fmtDay(new Date(Date.now() - 7 * 86400000)) });

export function getRx(ctx: Ctx, id: number) {
  const rx = ctx.db.first<any>(SELECT + " WHERE r.id=@id", { id });
  if (!rx) return null;
  if (rx.status === "Brouillon" && rx.doctorId !== ctx.user.id && ctx.user.role !== Roles.Principal) return null;
  return { rx, items: ctx.db.query("SELECT * FROM prescription_items WHERE prescription_id=@id ORDER BY position", { id }) };
}

export interface RxInput { id?: number; patientId: number; targetSecretaryId?: number | null; notes?: string | null; urgent?: boolean; items: RxItem[] }

export function saveRx(ctx: Ctx, input: RxInput, send: boolean, ack: boolean) {
  ctx.require(P.RxWrite);
  const items = Array.isArray(input.items) ? input.items.slice(0, 50) : [];
  const patientId = Number(input.patientId) || 0;
  const notes = clean(input.notes);
  const patient = ctx.db.first<any>("SELECT * FROM patients WHERE id=@patientId AND archived=0", { patientId }) ?? null;
  const r = validateRx(notes, items, patient);
  if (r.errors.length) throw new BizError(r.errors.join(" "));
  if (send && r.warnings.length && !ack) return { id: 0, warnings: r.warnings, needAck: true };
  let id = Number(input.id) || 0;
  if (id) {
    const ex = ctx.db.first<any>("SELECT * FROM prescriptions WHERE id=@id", { id });
    if (!ex) throw new BizError("Ordonnance introuvable.");
    if (ex.status !== "Brouillon") throw new BizError("Une ordonnance envoyée n'est plus modifiable : dupliquez-la.");
    if (ex.doctorId !== ctx.user.id && ctx.user.role !== Roles.Principal) throw new BizError("Seul l'auteur peut modifier cette ordonnance.");
  }
  const sid = Number(input.targetSecretaryId) || null;
  if (sid && !ctx.db.scalar("SELECT COUNT(*) FROM users WHERE id=@sid AND role='Secretaire' AND status='Actif'", { sid })) throw new BizError("Secrétaire destinataire invalide.");
  const lines = items.filter((i) => clean(i.medication));
  const isNew = !id;
  id = ctx.db.tx(() => {
    if (!id) {
      id = ctx.db.run(`INSERT INTO prescriptions(number,patient_id,doctor_id,target_secretary_id,created_at,status,notes,urgent)
        VALUES(@number,@patientId,@doctorId,@sid,@now,'Brouillon',@notes,@urgent)`,
        { number: nextNumber(ctx.db, "ORD"), patientId, doctorId: ctx.user.id, sid, now: new Date(), notes, urgent: !!input.urgent }).lastId;
    } else {
      ctx.db.run("UPDATE prescriptions SET patient_id=@patientId, target_secretary_id=@sid, notes=@notes, urgent=@urgent WHERE id=@id", { patientId, sid, notes, urgent: !!input.urgent, id });
      ctx.db.run("DELETE FROM prescription_items WHERE prescription_id=@id", { id });
    }
    lines.forEach((i, pos) => ctx.db.run(`INSERT INTO prescription_items(prescription_id,position,medication,dosage,frequency,duration,quantity,instructions)
      VALUES(@id,@pos,@m,@d,@f,@du,@q,@ins)`, { id, pos, m: i.medication.trim(), d: clean(i.dosage), f: clean(i.frequency), du: clean(i.duration), q: clean(i.quantity), ins: clean(i.instructions) }));
    return id;
  });
  audit(ctx.db, ctx.user, isNew ? "Création ordonnance" : "Modification ordonnance", "prescription", id);
  if (send) sendRx(ctx, id);
  bus.emit("prescriptions");
  return { id, warnings: r.warnings };
}

export function sendRx(ctx: Ctx, id: number) {
  ctx.require(P.RxWrite);
  const rx = ctx.db.first<any>(SELECT + " WHERE r.id=@id", { id });
  if (!rx) throw new BizError("Ordonnance introuvable.");
  if (rx.status !== "Brouillon") throw new BizError("Ordonnance déjà envoyée.");
  ctx.db.run("UPDATE prescriptions SET status='Envoyee', sent_at=@now WHERE id=@id", { now: new Date(), id });
  audit(ctx.db, ctx.user, "Envoi ordonnance au secrétariat", "prescription", id);
  metrics.rxSent++;
  const n = { kind: "ordonnance", title: rx.urgent ? "Ordonnance URGENTE à imprimer" : "Nouvelle ordonnance à imprimer",
    message: `${userTitle(ctx.user)} - patient ${rx.patientName} - ${rx.itemCount} ligne(s)`, link: `/ordonnances/${id}`, entityId: id, from: userTitle(ctx.user) };
  if (rx.targetSecretaryId) notifyUser(ctx.db, rx.targetSecretaryId, n); else notifyRole(ctx.db, Roles.Secretaire, n);
  log.info("ordonnances", `Ordonnance ${id} envoyée au secrétariat`);
  bus.emit("prescriptions", { sent: id });
}

export function markPrinted(ctx: Ctx, id: number) {
  ctx.require(P.RxPrint);
  const n = ctx.db.run(`UPDATE prescriptions SET status=CASE WHEN status IN ('Envoyee','Brouillon') THEN 'Imprimee' ELSE status END,
      printed_at=@now, printed_by=@uid, print_count=print_count+1 WHERE id=@id AND status <> 'Annulee'`, { now: new Date(), uid: ctx.user.id, id }).changes;
  if (!n) return;
  metrics.rxPrinted++;
  markEntityRead(ctx.db, "ordonnance", id);
  audit(ctx.db, ctx.user, "Impression ordonnance", "prescription", id);
  const rx = ctx.db.first<any>("SELECT * FROM prescriptions WHERE id=@id", { id });
  if (rx && rx.doctorId !== ctx.user.id && rx.printCount === 1)
    notifyUser(ctx.db, rx.doctorId, { kind: "imprimee", title: "Ordonnance imprimée", message: `${rx.number} imprimée par ${ctx.user.fullName}.`, link: `/ordonnances/${id}`, entityId: id, from: userTitle(ctx.user) });
  bus.emit("prescriptions");
}

export function setRxStatus(ctx: Ctx, id: number, status: string) {
  if (status !== "Remise" && status !== "Annulee") throw new BizError("Statut invalide.");
  if (status === "Annulee" && !ctx.can(P.RxWrite)) throw new BizError("Votre profil ne permet pas d'annuler une ordonnance.");
  if (status === "Remise" && !ctx.can(P.RxPrint)) throw new BizError("Votre profil ne permet pas de remettre une ordonnance.");
  ctx.db.run("UPDATE prescriptions SET status=@status WHERE id=@id", { status, id });
  audit(ctx.db, ctx.user, `Ordonnance : ${rxStatusLabel(status)}`, "prescription", id);
  bus.emit("prescriptions");
}

export function duplicateRx(ctx: Ctx, id: number) {
  ctx.require(P.RxWrite);
  const g = getRx(ctx, id);
  if (!g) throw new BizError("Ordonnance introuvable.");
  return saveRx(ctx, { patientId: g.rx.patientId, notes: g.rx.notes, targetSecretaryId: g.rx.targetSecretaryId, items: g.items as RxItem[] }, false, true);
}

export function saveTemplate(ctx: Ctx, name: string, description: string | null, items: RxItem[]) {
  ctx.require(P.RxWrite);
  const n = String(name ?? "").trim();
  if (n.length < 2 || n.length > 60) throw new BizError("Nom du modèle : 2 à 60 caractères.");
  const lines = (items ?? []).filter((i) => clean(i.medication)).slice(0, MAX_ITEMS)
    .map((i) => ({ medication: i.medication.trim(), dosage: clean(i.dosage), frequency: clean(i.frequency), duration: clean(i.duration), quantity: clean(i.quantity), instructions: clean(i.instructions) }));
  if (!lines.length) throw new BizError("Le modèle est vide.");
  const id = ctx.db.run("INSERT INTO rx_templates(name,description,items_json) VALUES(@n,@d,@j)", { n, d: clean(description)?.slice(0, 120) ?? null, j: JSON.stringify(lines) }).lastId;
  audit(ctx.db, ctx.user, "Création modèle d'ordonnance", "rx_template", id);
  return { id };
}
export function deleteTemplate(ctx: Ctx, id: number) {
  ctx.require(P.RxWrite);
  ctx.db.run("DELETE FROM rx_templates WHERE id=@id", { id });
  audit(ctx.db, ctx.user, "Suppression modèle d'ordonnance", "rx_template", id);
}
