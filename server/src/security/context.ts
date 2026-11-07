import type { Db } from "../db/db";
import { Roles, findPerm, permDefault, P } from "../../../shared/domain";
import { fmtDateTime } from "../../../shared/domain";

export interface User {
  id: number; username: string; fullName: string; email: string | null; phone: string | null;
  role: string; status: string; passwordHash: string; securityStamp: string; mustChangePassword: number;
  failedCount: number; lockoutUntil: string | null; rpps: string | null; specialty: string | null;
  color: string; autoPrint: number; createdAt: string; lastLoginAt: string | null;
}
/** Version publique (jamais de hash ni de jeton). */
export const publicUser = (u: User) => ({
  id: u.id, username: u.username, fullName: u.fullName, email: u.email, phone: u.phone, role: u.role, status: u.status,
  mustChangePassword: !!u.mustChangePassword, rpps: u.rpps, specialty: u.specialty, color: u.color, autoPrint: !!u.autoPrint,
  createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, locked: !!u.lockoutUntil && u.lockoutUntil > fmtDateTime(new Date()),
});

export class BizError extends Error { constructor(msg: string) { super(msg); } }
export class Forbidden extends Error { constructor(msg = "Accès refusé pour votre profil.") { super(msg); } }

// ------------------------------------------------------------------ Permissions par profil (cache)
let cache: Map<string, boolean> | null = null;
export function loadPerms(db: Db) {
  cache = new Map();
  for (const r of db.query<{ role: string; permission: string; allowed: number }>("SELECT role, permission, allowed FROM role_permissions"))
    cache.set(`${r.role}|${r.permission}`, !!r.allowed);
}
export function hasPerm(db: Db, role: string, key: string): boolean {
  if (role === Roles.Principal) return true;
  const def = findPerm(key); if (!def) return false;
  if (role === Roles.Secretaire && def.clinicalOnly) return false;
  if (!cache) loadPerms(db);
  const v = cache!.get(`${role}|${key}`);
  return v ?? permDefault(role, key);
}
export const isCustomized = (db: Db, role: string, key: string) => { if (!cache) loadPerms(db); return cache!.has(`${role}|${key}`); };
export function permsFor(db: Db, role: string): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const k of Object.values(P)) out[k] = hasPerm(db, role, k);
  return out;
}

/** Contexte d'une requête authentifiée : c'est ici que les droits sont réellement vérifiés (l'interface ne fait que masquer). */
export class Ctx {
  constructor(public db: Db, public user: User, public ip: string) {}
  can(key: string) { return hasPerm(this.db, this.user.role, key); }
  require(key: string) {
    if (!this.can(key)) throw new Forbidden(`Votre profil n'a pas la permission : ${findPerm(key)?.label ?? key}.`);
  }
  requirePrincipal() { if (this.user.role !== Roles.Principal) throw new Forbidden(); }
  requireDoctor() { if (this.user.role === Roles.Secretaire) throw new Forbidden(); }
}
