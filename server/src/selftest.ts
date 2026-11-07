import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Db } from "./db/db";
import { migrate } from "./db/schema";
import { checkAppointment, canTransition, isLateCancel, orderQueue } from "./services/rules";
import { validatePatient, isValidTooth } from "./services/patients";
import { validateRx } from "./services/prescriptions";
import { nextNumber } from "./services/core";
import { PermCatalog, permDefault, P, Roles, fmtDateTime } from "../../shared/domain";
import { hashPassword, verifyPassword, validatePassword, temporaryPassword } from "./security/passwords";

/** Auto-test des règles de gestion : npm run selftest */
export async function selfTest(): Promise<number> {
  let ok = 0, ko = 0;
  const check = (name: string, cond: boolean) => { cond ? ok++ : ko++; console.log(`  ${cond ? "✔" : "✘"} ${name}`); };
  const section = (n: string) => console.log(`── ${n}`);
  console.log("DentaCare - auto-test des règles de gestion\n");

  const now = new Date(2026, 10, 2, 9, 0, 0); // lundi
  const open: [number, number][] = [[8 * 60 + 30, 12 * 60 + 30], [14 * 60, 19 * 60]];
  const A = (h: number, m: number, dur: number, doc = 1, pat = 1, status = "Planifie", isUrgent = false) => {
    const s = new Date(2026, 10, 3, h, m), e = new Date(s.getTime() + dur * 60000);
    return { doctorId: doc, patientId: pat, startAt: fmtDateTime(s), endAt: fmtDateTime(e), status, isUrgent };
  };
  const okA = (a: any, busyD: any[] = [], busyP: any[] = [], o = open) => checkAppointment(a, now, o, busyD, busyP, true);

  section("Rendez-vous");
  check("Créneau valide accepté", !okA(A(9, 0, 30)).errors.length);
  check("Durée < 10 min refusée", okA(A(9, 0, 5)).errors.length > 0);
  check("Durée > 4 h refusée", okA(A(9, 0, 300)).errors.length > 0);
  check("Rendez-vous dans le passé refusé", checkAppointment({ ...A(9, 0, 30), startAt: "2026-11-01T09:00:00", endAt: "2026-11-01T09:30:00" }, now, open, [], [], true).errors.length > 0);
  check("Pendant la pause déjeuner refusé", okA(A(12, 30, 30)).errors.length > 0);
  check("Débordement sur la pause refusé", okA(A(12, 15, 30)).errors.length > 0);
  check("Cabinet fermé refusé", okA(A(10, 0, 30), [], [], []).errors.length > 0);
  const u = okA(A(20, 0, 20, 1, 1, "Planifie", true));
  check("Urgence hors horaires acceptée avec alerte", !u.errors.length && u.warnings.length > 0);
  check("Chevauchement praticien refusé", okA(A(9, 15, 30), [A(9, 0, 30)]).errors.length > 0);
  check("Créneaux contigus acceptés", !okA(A(9, 30, 30), [A(9, 0, 30)]).errors.length);
  check("RDV annulé ne bloque pas le créneau", !okA(A(9, 0, 30), [A(9, 0, 30, 1, 1, "Annule")]).errors.length);
  check("Chevauchement patient (autre praticien) refusé", okA(A(9, 0, 30, 1), [], [A(9, 10, 30, 2)]).errors.length > 0);
  check("Planifié → Confirmé autorisé", canTransition("Planifie", "Confirme"));
  check("Terminé → Annulé interdit", !canTransition("Termine", "Annule"));
  check("Planifié → Terminé interdit", !canTransition("Planifie", "Termine"));
  check("Annulation à 3 h = tardive", isLateCancel(new Date(now.getTime() + 3 * 3600000), now, 24));
  check("Annulation à 3 jours = normale", !isLateCancel(new Date(now.getTime() + 72 * 3600000), now, 24));

  section("File d'attente");
  const t0 = new Date(2026, 0, 5, 10, 0);
  const V = (id: number, arrMin: number, appt: number | null, priority = 0) => ({ id, queueNo: id, status: "EnAttente", priority, arrivedAt: fmtDateTime(new Date(t0.getTime() + arrMin * 60000)), apptStart: appt === null ? null : fmtDateTime(new Date(t0.getTime() + appt * 60000)) });
  const order = orderQueue([V(1, -20, null), V(2, -2, 0), V(3, -1, 60)], t0);
  check("RDV à l'heure passe avant un patient sans RDV", order[0].id === 2);
  check("RDV pas encore à l'heure reste à son rang d'arrivée", order[1].id === 1 && order[2].id === 3);
  check("Urgence toujours en tête", orderQueue([V(1, -20, null), V(2, -2, 0), V(4, 0, null, 1)], t0)[0].id === 4);

  section("Patients");
  const p = { lastName: "Test", firstName: "Alice", birthDate: "1990-05-01", phone: "06 12 34 56 78", sex: "F" };
  check("Patient valide accepté", !validatePatient(p).length);
  check("Téléphone invalide refusé", validatePatient({ ...p, phone: "abc" }).length > 0);
  check("Naissance dans le futur refusée", validatePatient({ ...p, birthDate: "2999-01-01" }).length > 0);
  check("N° sécu mal formé refusé", validatePatient({ ...p, ssn: "123" }).length > 0);
  check("Dent 36 valide (FDI)", isValidTooth(36));
  check("Dent 19 invalide (FDI)", !isValidTooth(19));

  section("Ordonnances");
  check("Ordonnance vide refusée", validateRx(null, [], p).errors.length > 0);
  check("Posologie obligatoire", validateRx(null, [{ medication: "Paracétamol 1 g", duration: "5 jours" }], p).errors.length > 0);
  check("Ligne complète acceptée", !validateRx(null, [{ medication: "Paracétamol 1 g", dosage: "1 cp", duration: "5 jours" }], p).errors.length);
  const v = validateRx(null, [{ medication: "Amoxicilline 1 g", dosage: "1 cp", duration: "7 jours" }], { allergies: "Pénicilline" });
  check("Alerte allergie pénicilline / amoxicilline", !v.errors.length && v.warnings.length > 0);
  check("16 lignes refusées", validateRx(null, Array.from({ length: 16 }, (_, i) => ({ medication: "M" + i, dosage: "1", duration: "1 j" })), p).errors.length > 0);

  section("Permissions par profil");
  check("Docteur principal : toutes les permissions", PermCatalog.every((x) => permDefault(Roles.Principal, x.key)));
  check("Secrétaire : ne peut pas prescrire", !permDefault(Roles.Secretaire, P.RxWrite));
  check("Secrétaire : gère la file d'attente", permDefault(Roles.Secretaire, P.QueueManage));
  check("Secrétaire : pas de données médicales par défaut", !permDefault(Roles.Secretaire, P.PatientMedical));
  check("Docteur : pas les indicateurs des autres par défaut", !permDefault(Roles.Docteur, P.PilotageAll));
  check("Actes médicaux jamais accordables à une secrétaire", PermCatalog.filter((x) => x.clinicalOnly).every((x) => !permDefault(Roles.Secretaire, x.key)));

  section("Sécurité");
  const h = hashPassword("Bonjour2026!");
  check("Hachage bcrypt vérifié avec le bon mot de passe", verifyPassword("Bonjour2026!", h));
  check("Hachage refusé avec un mauvais mot de passe", !verifyPassword("bonjour2026!", h));
  check("Deux hachages du même mot de passe diffèrent (sel)", h !== hashPassword("Bonjour2026!"));
  check("Mot de passe faible refusé", validatePassword("abc") !== null);
  check("Mot de passe sans chiffre refusé", validatePassword("AbcdefghijK") !== null);
  check("Mot de passe temporaire conforme", validatePassword(temporaryPassword()) === null);

  section("Base de données (SQLite / sql.js)");
  const tmp = path.join(os.tmpdir(), `dentacare-selftest-${process.pid}.db`);
  try {
    const db = await Db.open(tmp);
    migrate(db);
    check("Migration du schéma", Number(db.scalar("PRAGMA user_version")) >= 1);
    check("Référentiel d'actes chargé", Number(db.scalar("SELECT COUNT(*) FROM act_types")) > 5);
    check("Modèles d'ordonnance chargés", Number(db.scalar("SELECT COUNT(*) FROM rx_templates")) >= 5);
    const evil = "x'); DROP TABLE users; --";
    db.run("INSERT INTO settings(key,value) VALUES(@k,@v)", { k: "t", v: evil });
    check("Injection SQL neutralisée (requêtes paramétrées)", db.scalar("SELECT value FROM settings WHERE key='t'") === evil && db.scalar("SELECT COUNT(*) FROM sqlite_master WHERE name='users'") === 1);
    const n1 = nextNumber(db, "F"), n2 = nextNumber(db, "F");
    check(`Numérotation séquentielle (${n1} → ${n2})`, n1 !== n2 && n2.endsWith("00002"));
    try { db.tx(() => { db.run("INSERT INTO settings(key,value) VALUES('rb','1')"); throw new Error("x"); }); } catch { /* attendu */ }
    check("Transaction annulée en cas d'erreur", db.scalar("SELECT COUNT(*) FROM settings WHERE key='rb'") === 0);
    db.flush();
    check("Base écrite sur disque", fs.existsSync(tmp) && fs.statSync(tmp).size > 0);
    db.backupTo(tmp + ".bak");
    check("Sauvegarde cohérente", fs.existsSync(tmp + ".bak"));
    db.close();
  } finally {
    for (const f of [tmp, tmp + ".bak", tmp + ".tmp"]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  console.log(`\nRésultat : ${ok} réussis, ${ko} échoués`);
  return ko === 0 ? 0 : 1;
}
