import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { Db } from "../db/db";
import { fmtDateTime } from "../../../shared/domain";
import { Ctx, type User } from "./context";
import { findUser } from "../services/users";
import { log } from "../obs/log";

export const COOKIE = "dc_session";
const TTL_HOURS = 12;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie; if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("="); if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Ouvre une session : jeton aléatoire dans un cookie HttpOnly + SameSite=Strict ; seule son empreinte est stockée. */
export function openSession(db: Db, res: Response, user: User, ip: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.run("INSERT INTO sessions(id,user_id,stamp,created_at,expires_at,ip) VALUES(@id,@uid,@stamp,@now,@exp,@ip)",
    { id: sha(token), uid: user.id, stamp: user.securityStamp, now: new Date(), exp: new Date(Date.now() + TTL_HOURS * 3600000), ip });
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TTL_HOURS * 3600}`);
}
export function closeSession(db: Db, req: Request, res: Response) {
  const t = readCookie(req, COOKIE);
  if (t) db.run("DELETE FROM sessions WHERE id=@id", { id: sha(t) });
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
}

/** Utilisateur de la session, revalidé à chaque requête : compte actif + empreinte de sécurité inchangée. */
export function sessionUser(db: Db, req: Request): User | null {
  const t = readCookie(req, COOKIE);
  if (!t || t.length > 100) { log.debug("auth", `Pas de cookie de session : ${req.method} ${req.path} (en-tête cookie ${req.headers.cookie ? "présent" : "absent"})`); return null; }
  const s = db.first<{ userId: number; stamp: string; expiresAt: string }>("SELECT user_id, stamp, expires_at FROM sessions WHERE id=@id", { id: sha(t) });
  if (!s || s.expiresAt < fmtDateTime(new Date())) { log.debug("auth", `Session refusée (${s ? "expirée" : "inconnue"}) : ${req.method} ${req.path}`); return null; }
  const u = findUser(db, s.userId);
  if (!u || u.status !== "Actif" || u.securityStamp !== s.stamp) { log.debug("auth", `Session refusée (compte ou empreinte) : ${req.method} ${req.path}`); return null; }
  return u;
}
export const purgeSessions = (db: Db) => db.run("DELETE FROM sessions WHERE expires_at < @now", { now: new Date() });

export const clientIp = (req: Request) => (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");

declare global { namespace Express { interface Request { ctx?: Ctx } } }

/** Exige une session valide. Les requêtes qui modifient doivent porter l'en-tête X-DentaCare (protection CSRF). */
export function requireAuth(db: Db) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.headers["x-dentacare"] !== "1") { res.status(403).json({ error: "Requête refusée." }); return; }
    const u = sessionUser(db, req);
    if (!u) { res.status(401).json({ error: "Session expirée. Reconnectez-vous." }); return; }
    req.ctx = new Ctx(db, u, clientIp(req));
    // Mot de passe temporaire : seules les routes de compte restent ouvertes tant qu'il n'est pas changé.
    if (u.mustChangePassword && !req.path.startsWith("/auth/") && !req.path.startsWith("/me")) { res.status(403).json({ error: "Changez d'abord votre mot de passe.", mustChange: true }); return; }
    next();
  };
}
