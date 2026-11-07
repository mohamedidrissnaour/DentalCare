import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db/db";
import { Roles } from "../../../shared/domain";
import { temporaryPassword, hashPassword, newStamp } from "./passwords";
import { log } from "../obs/log";

export const DOCTOR_LOGIN = "docteur", SECRETARY_LOGIN = "secretaire", FILE_NAME = "identifiants-initiaux.txt";
let filePath = "";

/**
 * Premier démarrage (base vide) : création du docteur principal « docteur » (administrateur) et de « secretaire ».
 * Mots de passe aléatoires, affichés une seule fois dans la console et copiés dans le dossier de données ;
 * changement obligatoire à la première connexion ; fichier supprimé dès que les deux comptes l'ont fait.
 */
export function ensureInitialAccounts(db: Db, dataDir: string) {
  filePath = path.join(dataDir, FILE_NAME);
  if (db.scalar<number>("SELECT COUNT(*) FROM users")) return;
  const docPwd = temporaryPassword(), secPwd = temporaryPassword();
  const ins = (username: string, fullName: string, role: string, pwd: string, color: string, specialty: string | null) =>
    db.run(`INSERT INTO users(username,full_name,role,status,password_hash,security_stamp,must_change_password,specialty,color,created_at)
      VALUES(@username,@fullName,@role,'Actif',@hash,@stamp,1,@specialty,@color,@now)`,
      { username, fullName, role, hash: hashPassword(pwd), stamp: newStamp(), specialty, color, now: new Date() });
  db.tx(() => {
    ins(DOCTOR_LOGIN, "Principal", Roles.Principal, docPwd, "#14B1BB", "Chirurgien-dentiste");
    ins(SECRETARY_LOGIN, "Accueil", Roles.Secretaire, secPwd, "#1BAE7E", null);
  });
  fs.writeFileSync(filePath, [
    `DentaCare - identifiants du premier démarrage (${new Date().toLocaleString("fr-FR")})`, "",
    "Docteur principal (administrateur)", `  Identifiant : ${DOCTOR_LOGIN}`, `  Mot de passe temporaire : ${docPwd}`, "",
    "Secrétaire", `  Identifiant : ${SECRETARY_LOGIN}`, `  Mot de passe temporaire : ${secPwd}`, "",
    "Chaque compte choisit son propre mot de passe à la première connexion.",
    "Ce fichier est supprimé automatiquement dès que les deux mots de passe ont été changés.",
  ].join("\r\n"), { mode: 0o600 });
  // Console uniquement (jamais dans les journaux).
  console.log("\n==================== DentaCare - premier démarrage ====================");
  console.log(`  Docteur (administrateur) : ${DOCTOR_LOGIN.padEnd(12)} mot de passe temporaire : ${docPwd}`);
  console.log(`  Secrétaire               : ${SECRETARY_LOGIN.padEnd(12)} mot de passe temporaire : ${secPwd}`);
  console.log(`  (copie dans ${filePath})`);
  console.log("========================================================================\n");
  log.info("auth", `Comptes initiaux créés (docteur administrateur + secrétaire), identifiants dans ${FILE_NAME}`);
}
export function cleanupInitialFile(db: Db) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const pending = db.scalar<number>("SELECT COUNT(*) FROM users WHERE username IN (@d,@s) AND must_change_password=1", { d: DOCTOR_LOGIN, s: SECRETARY_LOGIN });
  if (!pending) try { fs.unlinkSync(filePath); } catch { /* best effort */ }
}
export const initialPending = () => !!filePath && fs.existsSync(filePath);

/** Mot de passe oublié, sur le poste serveur uniquement : npm run reset-password -- docteur */
export function resetFromConsole(db: Db, login: string): number {
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(login)) { console.log("Identifiant invalide."); return 2; }
  const u = db.first<{ id: number }>("SELECT id FROM users WHERE username=@login", { login });
  if (!u) {
    console.log("Aucun compte avec cet identifiant. Comptes existants :");
    for (const r of db.query<{ username: string; role: string }>("SELECT username, role FROM users ORDER BY id")) console.log(`  - ${r.username} (${r.role})`);
    return 1;
  }
  const temp = temporaryPassword();
  db.run(`UPDATE users SET password_hash=@h, security_stamp=@s, must_change_password=1, failed_count=0, lockout_until=NULL WHERE id=@id`, { h: hashPassword(temp), s: newStamp(), id: u.id });
  db.run("DELETE FROM sessions WHERE user_id=@id", { id: u.id });
  db.run(`INSERT INTO audit_log(at,user_id,username,action,entity,entity_id,details) VALUES(@at,NULL,'console-serveur','Réinitialisation du mot de passe (console)','user',@id,@login)`, { at: new Date(), id: u.id, login });
  db.flush();
  console.log("\n=============== DentaCare - mot de passe réinitialisé ===============");
  console.log(`  Identifiant             : ${login}`);
  console.log(`  Mot de passe temporaire : ${temp}`);
  console.log("  À changer obligatoirement à la prochaine connexion.");
  console.log("======================================================================");
  return 0;
}
