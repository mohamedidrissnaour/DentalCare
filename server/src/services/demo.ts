import { PaymentMethods, fmtDay, fmtDateTime } from "../../../shared/domain";
import { BizError, Ctx } from "../security/context";
import { audit } from "../security/audit";
import { nextNumber, openingRanges } from "./core";
import { bus } from "../obs/bus";

/** Données de démonstration FICTIVES (formation / démo), uniquement si la base ne contient encore aucun patient. */
const LAST = ["Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel", "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier", "Morel", "Girard", "André", "Mercier"];
const FIRST_F = ["Emma", "Léa", "Chloé", "Manon", "Camille", "Sarah", "Inès", "Jade", "Louise", "Alice", "Lina", "Nora"];
const FIRST_M = ["Lucas", "Hugo", "Louis", "Nathan", "Gabriel", "Arthur", "Jules", "Adam", "Raphaël", "Léo", "Yanis", "Karim"];

/** Générateur pseudo-aléatoire déterministe (données reproductibles, pas de cryptographie ici). */
function rng(seed: number) { let s = seed >>> 0; return (n: number) => { s = (s * 1664525 + 1013904223) >>> 0; return s % n; }; }

export const canSeed = (ctx: Ctx) => !ctx.db.scalar("SELECT COUNT(*) FROM patients");

export function seedDemo(ctx: Ctx): number {
  ctx.requirePrincipal();
  if (!canSeed(ctx)) throw new BizError("Des patients existent déjà : données de démonstration non chargées.");
  const r = rng(42), db = ctx.db, me = ctx.user.id;
  const doctors = db.query<any>("SELECT * FROM users WHERE role IN ('Principal','Docteur') AND status='Actif'");
  const acts = db.query<any>("SELECT * FROM act_types");
  const now = new Date();
  const at = (d: Date, min: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, min);
  let count = 0;
  db.tx(() => {
    const ids: number[] = [];
    for (let i = 0; i < 36; i++) {
      const f = r(2) === 0;
      const p = {
        fileNo: nextNumber(db, "P", false, 6), ln: LAST[r(LAST.length)], fn: f ? FIRST_F[r(FIRST_F.length)] : FIRST_M[r(FIRST_M.length)],
        bd: `${1950 + r(68)}-${String(1 + r(12)).padStart(2, "0")}-${String(1 + r(27)).padStart(2, "0")}`, sex: f ? "F" : "M",
        phone: `06 ${10 + r(89)} ${10 + r(89)} ${10 + r(89)} ${10 + r(89)}`, mut: r(3) === 0 ? "MGEN" : "Harmonie Mutuelle",
        al: r(7) === 0 ? "Pénicilline" : null, mh: r(5) === 0 ? "Hypertension artérielle" : null, doc: doctors[r(doctors.length)].id,
        created: new Date(now.getTime() - r(200) * 86400000),
      };
      if (db.scalar("SELECT COUNT(*) FROM patients WHERE last_name=@ln AND first_name=@fn AND birth_date=@bd", p)) continue;
      ids.push(db.run(`INSERT INTO patients(file_no,last_name,first_name,birth_date,sex,phone,city,postal_code,mutuelle,allergies,medical_history,primary_doctor_id,created_at,updated_at)
        VALUES(@fileNo,@ln,@fn,@bd,@sex,@phone,'Bordeaux','33000',@mut,@al,@mh,@doc,@created,@created)`, p).lastId);
      count++;
    }
    // Rendez-vous de J-20 à J+10 sur les créneaux d'ouverture, sans chevauchement.
    for (let d = -20; d <= 10; d++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      for (const doc of doctors) for (const [from, to] of openingRanges(db, day)) {
        let t = from;
        for (;;) {
          const act = acts[r(acts.length)];
          const end = t + act.durationMin;
          if (end > to) break;
          if (r(3) > 0) {
            const pid = ids[r(ids.length)];
            const s = at(day, t), e = at(day, end);
            if (Math.abs(s.getTime() - now.getTime()) > 60 * 60000 || d !== 0) {
              const past = e < now;
              const status = past ? (r(12) === 0 ? "Absent" : r(10) === 0 ? "Annule" : "Termine") : (r(3) === 0 ? "Confirme" : "Planifie");
              if (!db.scalar("SELECT COUNT(*) FROM appointments WHERE patient_id=@pid AND start_at<@e AND end_at>@s AND status NOT IN ('Annule','Absent')", { pid, e, s })) {
                const aid = db.run(`INSERT INTO appointments(patient_id,doctor_id,start_at,end_at,act_type_id,status,reason,created_by,created_at,cancel_reason)
                  VALUES(@pid,@doc,@s,@e,@act,@status,@reason,@me,@now,@cr)`, { pid, doc: doc.id, s, e, act: act.id, status, reason: act.label, me, now, cr: status === "Annule" ? "Empêchement" : null }).lastId;
                if (status === "Absent") db.run("UPDATE patients SET no_show_count=no_show_count+1 WHERE id=@pid", { pid });
                if (status === "Termine") {
                  const teeth = [11, 12, 16, 21, 26, 36, 37, 46, 47];
                  db.run(`INSERT INTO treatments(patient_id,doctor_id,appointment_id,performed_at,tooth,act_type_id,label,price) VALUES(@pid,@doc,@aid,@e,@tooth,@act,@label,@price)`,
                    { pid, doc: doc.id, aid, e, tooth: teeth[r(teeth.length)], act: act.id, label: act.label, price: act.price });
                }
              }
            }
          }
          t = end + r(4) * 15;
        }
      }
    }
    // Facturer et encaisser une partie des soins passés.
    for (const pid of ids) {
      const tr = db.query<any>("SELECT * FROM treatments WHERE patient_id=@pid AND invoice_id IS NULL ORDER BY performed_at", { pid });
      if (!tr.length || r(4) === 0) continue;
      const total = Math.round(tr.reduce((s, x) => s + x.price, 0) * 100) / 100;
      const paid = r(3) === 0 ? Math.round(total * 50) / 100 : total;
      const last = tr[tr.length - 1].performedAt;
      const invId = db.run("INSERT INTO invoices(number,patient_id,doctor_id,issued_at,total,paid,status,created_by) VALUES(@n,@pid,@doc,@at,@total,@paid,@st,@me)",
        { n: nextNumber(db, "F"), pid, doc: tr[0].doctorId, at: last, total, paid, st: paid >= total ? "Payee" : "Partielle", me }).lastId;
      for (const x of tr) {
        db.run("INSERT INTO invoice_lines(invoice_id,label,tooth,qty,unit_price) VALUES(@invId,@label,@tooth,1,@price)", { invId, label: x.label, tooth: x.tooth, price: x.price });
        db.run("UPDATE treatments SET invoice_id=@invId WHERE id=@id", { invId, id: x.id });
      }
      db.run("INSERT INTO payments(invoice_id,paid_at,amount,method,received_by) VALUES(@invId,@at,@paid,@m,@me)", { invId, at: last, paid, m: PaymentMethods[r(3)], me });
    }
    // Traitements en plusieurs séances (dévitalisation en 3, couronne en 2).
    const devi = acts.find((a) => a.code === "DEVI"), cour = acts.find((a) => a.code === "COUR");
    ids.slice(2, 8).forEach((pid, k) => {
      const act = k % 2 === 0 ? devi : cour; if (!act) return;
      const doc = doctors[k % doctors.length], teeth = [36, 46, 16, 26, 47, 37], planned = act.code === "DEVI" ? 3 : 2;
      const planId = db.run(`INSERT INTO treatment_plans(patient_id,doctor_id,tooth,act_type_id,label,sessions_planned,estimated_price,status,created_at)
        VALUES(@pid,@doc,@tooth,@act,@label,@planned,@price,'EnCours',@at)`, { pid, doc: doc.id, tooth: teeth[k], act: act.id, label: act.label, planned, price: act.price * planned, at: new Date(now.getTime() + (-20 + k) * 86400000) }).lastId;
      const done = 1 + (k % planned);
      for (let sn = 1; sn <= done; sn++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 20 + k + sn * 6, 10);
        db.run(`INSERT INTO treatments(patient_id,doctor_id,performed_at,tooth,act_type_id,label,price,plan_id,session_no) VALUES(@pid,@doc,@at,@tooth,@act,@label,@price,@planId,@sn)`,
          { pid, doc: doc.id, at: d > now ? now : d, tooth: teeth[k], act: act.id, label: `${act.label} - séance ${sn}/${planned}`, price: act.price, planId, sn });
      }
      if (done >= planned) db.run("UPDATE treatment_plans SET status='Termine', closed_at=@now WHERE id=@planId", { now, planId });
    });
    // File d'attente du jour : un terminé, un en consultation, trois en attente (dont une urgence).
    const today = fmtDay(now);
    const complaints = ["Douleur en bas à droite depuis 3 jours", "Contrôle annuel", "Dent cassée en mangeant", "Gencive qui saigne", "Suite du traitement"];
    for (let q = 0; q < 5; q++) {
      const pid = ids[ids.length - 1 - q], arrived = new Date(now.getTime() + (-90 + q * 15) * 60000);
      db.run(`INSERT INTO visits(patient_id,visit_day,queue_no,arrived_at,status,priority,doctor_id,complaint,diagnosis,started_at,ended_at,registered_by)
        VALUES(@pid,@today,@no,@arrived,@status,@prio,@doc,@c,@diag,@started,@ended,@me)`, {
        pid, today, no: q + 1, arrived, status: q === 0 ? "Termine" : q === 1 ? "EnConsultation" : "EnAttente", prio: q === 4 ? 1 : 0,
        doc: q <= 1 ? doctors[0].id : null, c: complaints[q], diag: q === 0 ? "Détartrage, gingivite légère" : null,
        started: q <= 1 ? new Date(arrived.getTime() + 12 * 60000) : null, ended: q === 0 ? new Date(arrived.getTime() + 40 * 60000) : null, me,
      });
    }
    // Deux rendez-vous attendus aujourd'hui (un en retard, un dans 15 min) pour la carte « Rendez-vous attendus ».
    [[-20, ids[0]], [15, ids[1]]].forEach(([off, pid]) => {
      const s = new Date(Math.floor((now.getTime() + off * 60000) / 300000) * 300000), e = new Date(s.getTime() + 30 * 60000);
      if (fmtDay(s) !== today) return;
      db.run(`INSERT INTO appointments(patient_id,doctor_id,start_at,end_at,act_type_id,status,reason,created_by,created_at) VALUES(@pid,@doc,@s,@e,@act,'Confirme','Contrôle',@me,@now)`,
        { pid, doc: doctors[0].id, s: fmtDateTime(s), e: fmtDateTime(e), act: acts.find((a) => a.code === "CTRL")?.id ?? null, me, now });
    });
  });
  audit(db, ctx.user, "Chargement des données de démonstration", undefined, null, `${count} patients fictifs`);
  bus.emit("visits"); bus.emit("appointments");
  return count;
}
