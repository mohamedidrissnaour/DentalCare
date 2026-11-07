import { P, RecallKind, fmtDay } from "../../../shared/domain";
import { Ctx } from "../security/context";

/** Journal de caisse : encaissements d'un jour. */
export function cashJournal(ctx: Ctx, day: string) {
  ctx.require(P.BillingCollect);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : fmtDay(new Date());
  const next = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1);
  return ctx.db.query(`SELECT p.id, p.paid_at, p.amount, p.method, i.id AS invoice_id, i.number AS invoice_number,
      pt.id AS patient_id, pt.last_name||' '||pt.first_name AS patient_name, d.full_name AS doctor_name, u.full_name AS received_by_name
    FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN patients pt ON pt.id = i.patient_id
    JOIN users d ON d.id = i.doctor_id JOIN users u ON u.id = p.received_by
    WHERE p.paid_at >= @from AND p.paid_at < @to AND i.status <> 'Annulee' ORDER BY p.paid_at`,
    { from: d + "T00:00:00", to: fmtDay(next) + "T00:00:00" });
}

export const CHECKUP_MONTHS = 6;

/** Patients à rappeler : absents sans nouveau RDV, plans en cours sans RDV, contrôle à prévoir, restes à payer. */
export function recalls(ctx: Ctx) {
  ctx.require(P.AgendaEdit);
  const now = new Date();
  const noFuture = "NOT EXISTS (SELECT 1 FROM appointments f WHERE f.patient_id = p.id AND f.start_at >= @now AND f.status IN ('Planifie','Confirme'))";
  const list: any[] = [];
  list.push(...ctx.db.query(`SELECT p.id AS patient_id, p.last_name||' '||p.first_name AS patient_name, p.phone, @kind AS kind, MAX(a.start_at) AS since,
      'Absent au rendez-vous' || CASE WHEN COUNT(*) > 1 THEN ' (' || COUNT(*) || ' fois)' ELSE '' END AS detail, 0 AS due
    FROM appointments a JOIN patients p ON p.id = a.patient_id
    WHERE a.status = 'Absent' AND a.start_at >= @limit AND p.archived = 0 AND ${noFuture}
    GROUP BY p.id ORDER BY since DESC`, { now, limit: new Date(now.getTime() - 90 * 86400000), kind: RecallKind.NoShow }));
  list.push(...ctx.db.query(`SELECT p.id AS patient_id, p.last_name||' '||p.first_name AS patient_name, p.phone, @kind AS kind,
      tp.label || ' : ' || (SELECT COUNT(*) FROM treatments t WHERE t.plan_id = tp.id) || '/' || tp.sessions_planned || ' séances' AS detail,
      IFNULL((SELECT MAX(t.performed_at) FROM treatments t WHERE t.plan_id = tp.id), tp.created_at) AS since, 0 AS due
    FROM treatment_plans tp JOIN patients p ON p.id = tp.patient_id
    WHERE tp.status = 'EnCours' AND p.archived = 0 AND ${noFuture} ORDER BY since`, { now, kind: RecallKind.Plan }));
  list.push(...ctx.db.query(`SELECT p.id AS patient_id, p.last_name||' '||p.first_name AS patient_name, p.phone, @kind AS kind,
      MAX(t.performed_at) AS since, 'Dernier soin : ' || t.label AS detail, 0 AS due
    FROM treatments t JOIN patients p ON p.id = t.patient_id
    WHERE p.archived = 0 AND ${noFuture}
    GROUP BY p.id HAVING MAX(t.performed_at) < @limit AND MAX(t.performed_at) >= @oldest ORDER BY since`,
    { now, limit: new Date(now.getFullYear(), now.getMonth() - CHECKUP_MONTHS, now.getDate()), oldest: new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()), kind: RecallKind.Checkup }));
  list.push(...ctx.db.query(`SELECT * FROM (
      SELECT p.id AS patient_id, p.last_name||' '||p.first_name AS patient_name, p.phone, @kind AS kind,
        IFNULL((SELECT SUM(i.total - i.paid) FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('Impayee','Partielle')), 0)
      + IFNULL((SELECT SUM(t.price) FROM treatments t WHERE t.patient_id = p.id AND t.invoice_id IS NULL AND t.performed_at < @today), 0) AS due,
        (SELECT MIN(i.issued_at) FROM invoices i WHERE i.patient_id = p.id AND i.status IN ('Impayee','Partielle')) AS since,
        'Soins non réglés' AS detail
      FROM patients p WHERE p.archived = 0) WHERE due > 0.009 ORDER BY due DESC`, { today: fmtDay(now) + "T00:00:00", kind: RecallKind.Unpaid }));
  return list;
}
