import type { Db } from "../db/db";
import { Roles, UserStatus, isDoctor, roleLabel, fmtDateTime } from "../../../shared/domain";
import { hashPassword, verifyPassword, dummyHash, validatePassword, temporaryPassword, newStamp } from "../security/passwords";
import { type User, BizError, Ctx } from "../security/context";
import { audit } from "../security/audit";
import { notifyRole } from "./core";
import { metrics } from "../obs/metrics";
import { log } from "../obs/log";
import { bus } from "../obs/bus";
import { cleanupInitialFile } from "../security/initial";

const MAX_FAILURES = 5, LOCK_MIN = 15;
const PALETTE = ["#14B1BB", "#1BAE7E", "#6C63D9", "#E0A030", "#14866A", "#0B7C84", "#21CDC0", "#475569"];
const USERNAME_RX = /^[a-zA-Z0-9._-]{3,32}$/, EMAIL_RX = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/, RPPS_RX = /^\d{11}$/;

export const findUser = (db: Db, id: number) => db.first<User>("SELECT * FROM users WHERE id=@id", { id });
export const findByUsername = (db: Db, username: string) => db.first<User>("SELECT * FROM users WHERE username=@username", { username });
export const allUsers = (db: Db) => db.query<User>("SELECT * FROM users ORDER BY CASE role WHEN 'Principal' THEN 0 WHEN 'Docteur' THEN 1 ELSE 2 END, full_name");
export const activeDoctors = (db: Db) => db.query<User>("SELECT * FROM users WHERE role IN ('Principal','Docteur') AND status='Actif' ORDER BY role DESC, full_name");
export const activeSecretaries = (db: Db) => db.query<User>("SELECT * FROM users WHERE role='Secretaire' AND status='Actif' ORDER BY full_name");

export function insertUser(db: Db, u: { username: string; fullName: string; email?: string | null; phone?: string | null; role: string; rpps?: string | null; specialty?: string | null; color?: string }, password: string, mustChange: boolean): number {
  const count = db.scalar<number>("SELECT COUNT(*) FROM users") ?? 0;
  return db.run(`INSERT INTO users(username,full_name,email,phone,role,status,password_hash,security_stamp,must_change_password,rpps,specialty,color,created_at)
    VALUES(@username,@fullName,@email,@phone,@role,'Actif',@hash,@stamp,@mustChange,@rpps,@specialty,@color,@now)`, {
    username: u.username, fullName: u.fullName, email: u.email || null, phone: u.phone || null, role: u.role,
    hash: hashPassword(password), stamp: newStamp(), mustChange, rpps: u.rpps || null, specialty: u.specialty || null,
    color: u.color ?? PALETTE[count % PALETTE.length], now: new Date(),
  }).lastId;
}

export type LoginOutcome = "ok" | "invalid" | "locked" | "disabled" | "mustChange";

export function login(db: Db, username: string, password: string, ip: string): { outcome: LoginOutcome; user?: User } {
  const u = findByUsername(db, String(username ?? "").trim().slice(0, 64));
  if (!u) {
    verifyPassword(String(password ?? ""), dummyHash); // temps constant : ne révèle pas l'existence du compte
    metrics.loginFailure++;
    audit(db, null, "Connexion refusée (identifiant inconnu)", undefined, null, undefined, ip);
    return { outcome: "invalid" };
  }
  const now = fmtDateTime(new Date());
  if (u.lockoutUntil && u.lockoutUntil > now) { metrics.loginFailure++; return { outcome: "locked" }; }
  if (!verifyPassword(String(password ?? ""), u.passwordHash)) {
    const failed = u.failedCount + 1;
    const lockUntil = failed >= MAX_FAILURES ? new Date(Date.now() + LOCK_MIN * 60000) : null;
    db.run("UPDATE users SET failed_count=@f, lockout_until=@l WHERE id=@id", { f: lockUntil ? 0 : failed, l: lockUntil, id: u.id });
    metrics.loginFailure++;
    audit(db, u, lockUntil ? "Compte verrouillé 15 min (5 échecs)" : "Connexion refusée (mot de passe)", "user", u.id, undefined, ip);
    if (lockUntil) {
      log.warn("auth", `Compte ${u.id} verrouillé après ${MAX_FAILURES} échecs`);
      notifyRole(db, Roles.Principal, { kind: "securite", title: "Compte verrouillé", message: `Le compte « ${u.username} » a été verrouillé après 5 tentatives échouées.`, link: "/admin/audit" });
    }
    return { outcome: lockUntil ? "locked" : "invalid" };
  }
  if (u.status !== UserStatus.Active) return { outcome: "disabled" };
  db.run("UPDATE users SET failed_count=0, lockout_until=NULL, last_login_at=@now WHERE id=@id", { now: new Date(), id: u.id });
  metrics.loginSuccess++;
  audit(db, u, "Connexion", "user", u.id, undefined, ip);
  return { outcome: u.mustChangePassword ? "mustChange" : "ok", user: findUser(db, u.id) };
}

export function changePassword(db: Db, userId: number, current: string, next: string, confirm: string) {
  const u = findUser(db, userId);
  if (!u) throw new BizError("Compte introuvable.");
  if (!verifyPassword(String(current ?? ""), u.passwordHash)) throw new BizError("Mot de passe actuel incorrect.");
  const e = validatePassword(next); if (e) throw new BizError(e);
  if (next !== confirm) throw new BizError("Les mots de passe ne correspondent pas.");
  if (next === current) throw new BizError("Le nouveau mot de passe doit être différent de l'ancien.");
  const stamp = newStamp();
  db.run("UPDATE users SET password_hash=@h, security_stamp=@s, must_change_password=0 WHERE id=@id", { h: hashPassword(next), s: stamp, id: userId });
  db.run("DELETE FROM sessions WHERE user_id=@id", { id: userId });
  audit(db, u, "Changement de mot de passe", "user", userId);
  cleanupInitialFile(db);
  return stamp;
}

// ------------------------------------------------------------------ Administration (docteur principal)
interface NewUser { username?: string; fullName?: string; email?: string; phone?: string; role?: string; rpps?: string; specialty?: string }
export function createByAdmin(ctx: Ctx, i: NewUser): { id: number; tempPassword: string } {
  ctx.requirePrincipal();
  const username = String(i.username ?? "").trim(), fullName = String(i.fullName ?? "").trim();
  const errors: string[] = [];
  if (!USERNAME_RX.test(username)) errors.push("Identifiant : 3 à 32 caractères (lettres, chiffres, . _ -).");
  if (fullName.length < 3 || fullName.length > 80) errors.push("Nom complet : 3 à 80 caractères.");
  if (i.email?.trim() && !EMAIL_RX.test(i.email.trim())) errors.push("Adresse e-mail invalide.");
  if (i.role !== Roles.Docteur && i.role !== Roles.Secretaire) errors.push("Profil invalide.");
  if (isDoctor(i.role ?? "") && i.rpps?.trim() && !RPPS_RX.test(i.rpps.trim())) errors.push("Le n° RPPS comporte 11 chiffres.");
  if (!errors.length && findByUsername(ctx.db, username)) errors.push("Cet identifiant est déjà utilisé.");
  if (errors.length) throw new BizError(errors.join(" "));
  const temp = temporaryPassword();
  const id = insertUser(ctx.db, { username, fullName, email: i.email?.trim(), phone: i.phone?.trim(), role: i.role!, rpps: i.rpps?.trim(), specialty: i.specialty?.trim() }, temp, true);
  audit(ctx.db, ctx.user, "Création de compte", "user", id, `profil=${i.role}`);
  bus.emit("users");
  return { id, tempPassword: temp };
}

export function resetPassword(ctx: Ctx, id: number): string {
  ctx.requirePrincipal();
  const temp = temporaryPassword();
  ctx.db.run("UPDATE users SET password_hash=@h, security_stamp=@s, must_change_password=1, failed_count=0, lockout_until=NULL WHERE id=@id",
    { h: hashPassword(temp), s: newStamp(), id });
  ctx.db.run("DELETE FROM sessions WHERE user_id=@id", { id });
  bus.kick(id);
  audit(ctx.db, ctx.user, "Réinitialisation du mot de passe", "user", id);
  return temp;
}
export function unlock(ctx: Ctx, id: number) {
  ctx.requirePrincipal();
  ctx.db.run("UPDATE users SET failed_count=0, lockout_until=NULL WHERE id=@id", { id });
  audit(ctx.db, ctx.user, "Déverrouillage de compte", "user", id);
}
export function setStatus(ctx: Ctx, id: number, status: string) {
  ctx.requirePrincipal();
  if (id === ctx.user.id) throw new BizError("Vous ne pouvez pas modifier votre propre statut.");
  if (status !== UserStatus.Active && status !== UserStatus.Disabled) throw new BizError("Statut invalide.");
  ctx.db.run("UPDATE users SET status=@status, security_stamp=@stamp WHERE id=@id", { status, stamp: newStamp(), id });
  if (status === UserStatus.Disabled) { ctx.db.run("DELETE FROM sessions WHERE user_id=@id", { id }); bus.kick(id); }
  audit(ctx.db, ctx.user, status === UserStatus.Disabled ? "Désactivation de compte" : "Activation de compte", "user", id);
  bus.emit("users");
}
export function changeRole(ctx: Ctx, id: number, role: string) {
  ctx.requirePrincipal();
  if (id === ctx.user.id) throw new BizError("Vous ne pouvez pas modifier votre propre profil.");
  if (role !== Roles.Docteur && role !== Roles.Secretaire) throw new BizError("Profil invalide.");
  ctx.db.run("UPDATE users SET role=@role, security_stamp=@stamp WHERE id=@id", { role, stamp: newStamp(), id });
  ctx.db.run("DELETE FROM sessions WHERE user_id=@id", { id }); bus.kick(id);
  audit(ctx.db, ctx.user, "Changement de profil", "user", id, `profil=${roleLabel(role)}`);
  bus.emit("users");
}
export function transferPrincipal(ctx: Ctx, toId: number) {
  ctx.requirePrincipal();
  const t = findUser(ctx.db, toId);
  if (!t || t.role !== Roles.Docteur || t.status !== UserStatus.Active) throw new BizError("Le rôle principal ne peut être transféré qu'à un docteur actif.");
  ctx.db.tx(() => {
    ctx.db.run("UPDATE users SET role='Docteur', security_stamp=@s WHERE id=@id", { s: newStamp(), id: ctx.user.id });
    ctx.db.run("UPDATE users SET role='Principal', security_stamp=@s WHERE id=@id", { s: newStamp(), id: toId });
    ctx.db.run("DELETE FROM sessions WHERE user_id IN (@a,@b)", { a: ctx.user.id, b: toId });
  });
  audit(ctx.db, ctx.user, "Transfert du rôle de docteur principal", "user", toId);
  bus.kick(toId); bus.kick(ctx.user.id);
}
export function updateProfile(ctx: Ctx, p: { fullName?: string; email?: string; phone?: string; rpps?: string; specialty?: string; color?: string; autoPrint?: boolean }) {
  const fullName = String(p.fullName ?? "").trim();
  if (fullName.length < 3 || fullName.length > 80) throw new BizError("Nom complet : 3 à 80 caractères.");
  if (p.email?.trim() && !EMAIL_RX.test(p.email.trim())) throw new BizError("Adresse e-mail invalide.");
  if (p.rpps?.trim() && !RPPS_RX.test(p.rpps.trim())) throw new BizError("Le n° RPPS comporte 11 chiffres.");
  const color = /^#[0-9a-fA-F]{6}$/.test(p.color ?? "") ? p.color : ctx.user.color;
  ctx.db.run(`UPDATE users SET full_name=@fullName, email=@email, phone=@phone, rpps=@rpps, specialty=@specialty, color=@color, auto_print=@autoPrint WHERE id=@id`,
    { fullName, email: p.email?.trim().slice(0, 120) || null, phone: p.phone?.trim().slice(0, 20) || null, rpps: p.rpps?.trim() || null, specialty: p.specialty?.trim().slice(0, 80) || null, color, autoPrint: !!p.autoPrint, id: ctx.user.id });
  audit(ctx.db, ctx.user, "Mise à jour du profil", "user", ctx.user.id);
  bus.emit("users");
}
