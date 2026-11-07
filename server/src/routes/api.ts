import os from "node:os";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import type { Db } from "../db/db";
import { P, PermCatalog, PaymentMethods, Roles, findPerm, roleLabel, fmtDay } from "../../../shared/domain";
import { BizError, Forbidden, publicUser, permsFor, hasPerm, isCustomized, loadPerms, type Ctx } from "../security/context";
import { requireAuth, openSession, closeSession, clientIp } from "../security/sessions";
import { initialPending } from "../security/initial";
import { audit } from "../security/audit";
import { log } from "../obs/log";
import { metrics } from "../obs/metrics";
import { bus } from "../obs/bus";
import * as core from "../services/core";
import * as users from "../services/users";
import * as patients from "../services/patients";
import * as appts from "../services/appointments";
import * as visits from "../services/visits";
import * as billing from "../services/billing";
import * as rx from "../services/prescriptions";
import * as stats from "../services/stats";
import * as follow from "../services/followup";
import * as demo from "../services/demo";

type Handler = (ctx: Ctx, req: Request, res: Response) => unknown;
const id = (req: Request) => { const n = Number(req.params.id); if (!Number.isInteger(n) || n <= 0) throw new BizError("Identifiant invalide."); return n; };
const qs = (req: Request, k: string) => (typeof req.query[k] === "string" ? (req.query[k] as string) : undefined);
const qn = (req: Request, k: string) => { const v = Number(qs(req, k)); return Number.isInteger(v) && v > 0 ? v : null; };

/** Erreurs : message métier lisible (400), accès refusé (403), sinon message générique (500) et détail dans le journal. */
export function sendError(res: Response, e: unknown) {
  if (e instanceof BizError) { res.status(400).json({ error: e.message }); return; }
  if (e instanceof Forbidden) { res.status(403).json({ error: e.message }); return; }
  log.error("api", "Erreur inattendue", e);
  res.status(500).json({ error: "Une erreur inattendue est survenue. Elle a été enregistrée dans le journal." });
}

export function apiRouter(db: Db, backups: stats.Backups): Router {
  const r = Router();
  const auth = requireAuth(db);
  const h = (fn: Handler) => (req: Request, res: Response) => {
    try {
      const out = fn(req.ctx!, req, res);
      if (!res.headersSent) res.json(out === undefined ? { ok: true } : out);
    } catch (e) { sendError(res, e); }
  };
  const get = (p: string, fn: Handler) => r.get(p, auth, h(fn));
  const post = (p: string, fn: Handler) => r.post(p, auth, h(fn));
  const put = (p: string, fn: Handler) => r.put(p, auth, h(fn));
  const del = (p: string, fn: Handler) => r.delete(p, auth, h(fn));

  // ---------------------------------------------------------------- Connexion
  r.get("/auth/state", (_req, res) => { res.json({ initialPending: initialPending(), cabinet: core.getSettings(db).name }); });
  r.post("/auth/login", (req, res) => {
    try {
      if (req.headers["x-dentacare"] !== "1") { res.status(403).json({ error: "Requête refusée." }); return; }
      const ip = clientIp(req);
      const { outcome, user } = users.login(db, req.body?.username, req.body?.password, ip);
      if (outcome === "invalid") { res.status(401).json({ error: "Identifiant ou mot de passe incorrect." }); return; }
      if (outcome === "locked") { res.status(423).json({ error: "Compte verrouillé 15 minutes après 5 échecs. Réessayez plus tard ou demandez au docteur principal de le déverrouiller." }); return; }
      if (outcome === "disabled") { res.status(403).json({ error: "Ce compte est désactivé." }); return; }
      openSession(db, res, user!, ip);
      res.json({ mustChange: outcome === "mustChange" });
    } catch (e) { sendError(res, e); }
  });
  r.post("/auth/logout", (req, res) => { log.info("auth", "Déconnexion demandée"); closeSession(db, req, res); res.json({ ok: true }); });

  // ---------------------------------------------------------------- Moi
  get("/me", (ctx) => ({
    user: publicUser(ctx.user), perms: permsFor(db, ctx.user.role), unread: core.unreadCount(db, ctx.user.id),
    cabinet: core.getSettings(db).name, queue: stats.queueToday(db),
    rxToPrint: ctx.can(P.RxPrint) ? db.scalar<number>("SELECT COUNT(*) FROM prescriptions WHERE status='Envoyee'") ?? 0 : 0,
  }));
  post("/me/password", (ctx, req, res) => {
    const stamp = users.changePassword(db, ctx.user.id, req.body?.current, req.body?.next, req.body?.confirm);
    // Les autres sessions de l'utilisateur sont supprimées ; celle-ci est rouverte avec la nouvelle empreinte.
    openSession(db, res, { ...ctx.user, securityStamp: stamp }, ctx.ip);
    return { ok: true };
  });
  put("/me/profile", (ctx, req) => users.updateProfile(ctx, req.body ?? {}));

  // Temps réel (Server-Sent Events)
  r.get("/events", auth, (req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    bus.add(req.ctx!.user.id, req.ctx!.user.fullName, req.ctx!.user.role, res);
  });

  // ---------------------------------------------------------------- Référentiels
  get("/ref", () => ({
    doctors: users.activeDoctors(db).map(publicUser), secretaries: users.activeSecretaries(db).map(publicUser),
    actTypes: appts.actTypes(db, false), settings: core.getSettings(db), paymentMethods: PaymentMethods,
  }));

  // ---------------------------------------------------------------- Patients
  get("/patients", (ctx, req) => patients.searchPatients(ctx, qs(req, "q"), qs(req, "archived") === "1"));
  get("/patients/:id", (ctx, req) => { const p = patients.getPatient(ctx, id(req)); if (!p) throw new BizError("Dossier introuvable."); return p; });
  get("/patients/:id/dossier", (ctx, req) => {
    const pid = id(req);
    const p = patients.getPatient(ctx, pid); if (!p) throw new BizError("Dossier introuvable.");
    return {
      patient: p, summary: stats.patientSummary(ctx, pid), treatments: billing.patientTreatments(ctx, pid), plans: billing.patientPlans(ctx, pid),
      appointments: appts.patientAppointments(ctx, pid), visits: visits.patientVisits(ctx, pid), payments: billing.patientPayments(ctx, pid),
      invoices: billing.invoices(ctx, null, pid), prescriptions: rx.listRx(ctx, null, pid),
    };
  });
  post("/patients", (ctx, req) => ({ id: patients.savePatient(ctx, req.body ?? {}) }));
  post("/patients/:id/archive", (ctx, req) => patients.archivePatient(ctx, id(req), !!req.body?.archived));
  post("/patients/:id/anonymize", (ctx, req) => patients.anonymizePatient(ctx, id(req)));

  // ---------------------------------------------------------------- Agenda
  get("/appointments", (ctx, req) => appts.rangeAppointments(ctx, qs(req, "from") ?? "", qs(req, "to") ?? "", qn(req, "doctorId")));
  get("/appointments/free-slots", (ctx, req) => appts.freeSlots(ctx, qn(req, "doctorId") ?? 0, qs(req, "from") ?? fmtDay(new Date()), Number(qs(req, "duration")) || 30));
  get("/appointments/:id", (ctx, req) => appts.getAppointment(ctx, id(req)) ?? null);
  post("/appointments/check", (ctx, req) => appts.checkAppt(ctx, req.body ?? {}));
  post("/appointments", (ctx, req) => appts.saveAppointment(ctx, req.body ?? {}));
  post("/appointments/:id/status", (ctx, req) => appts.changeApptStatus(ctx, id(req), String(req.body?.to ?? ""), req.body?.reason));

  // ---------------------------------------------------------------- File d'attente
  get("/queue", (ctx, req) => ({ visits: visits.todayQueue(ctx, qs(req, "day")), expected: visits.expectedAppointments(ctx), stats: stats.queueToday(db) }));
  post("/queue/arrival", (ctx, req) => visits.registerArrival(ctx, Number(req.body?.patientId) || 0, req.body?.complaint, !!req.body?.urgent, Number(req.body?.doctorId) || null));
  post("/queue/new-patient", (ctx, req) => visits.registerNewPatient(ctx, req.body?.patient ?? {}, req.body?.complaint, !!req.body?.urgent, Number(req.body?.doctorId) || null));
  post("/queue/:id/call", (ctx, req) => visits.callVisit(ctx, id(req)));
  post("/queue/:id/finish", (ctx, req) => visits.finishVisit(ctx, id(req)));
  post("/queue/:id/back", (ctx, req) => visits.backToQueue(ctx, id(req)));
  post("/queue/:id/leave", (ctx, req) => visits.leaveQueue(ctx, id(req), req.body?.reason));
  post("/queue/:id/complaint", (ctx, req) => visits.updateComplaint(ctx, id(req), req.body?.text));
  post("/queue/:id/diagnosis", (ctx, req) => visits.updateDiagnosis(ctx, id(req), req.body?.text));
  post("/queue/:id/priority", (ctx, req) => visits.setPriority(ctx, id(req), !!req.body?.urgent));
  post("/queue/:id/doctor", (ctx, req) => visits.assignDoctor(ctx, id(req), Number(req.body?.doctorId) || null));

  // ---------------------------------------------------------------- Soins, plans, facturation
  post("/treatments", (ctx, req) => billing.addTreatment(ctx, req.body ?? {}));
  del("/treatments/:id", (ctx, req) => billing.deleteTreatment(ctx, id(req)));
  post("/plans", (ctx, req) => billing.createPlan(ctx, req.body ?? {}));
  post("/plans/:id/status", (ctx, req) => billing.setPlanStatus(ctx, id(req), String(req.body?.status ?? "")));
  get("/billing/unbilled", (ctx, req) => billing.unbilled(ctx, qn(req, "patientId")));
  get("/billing/invoices", (ctx, req) => billing.invoices(ctx, qs(req, "status"), qn(req, "patientId")));
  get("/billing/invoices/:id", (ctx, req) => billing.invoice(ctx, id(req)));
  post("/billing/invoices", (ctx, req) => billing.invoiceTreatments(ctx, Number(req.body?.patientId) || 0, req.body?.treatmentIds ?? []));
  post("/billing/invoices/:id/payments", (ctx, req) => billing.addPayment(ctx, id(req), Number(req.body?.amount), String(req.body?.method ?? "")));
  post("/billing/invoices/:id/cancel", (ctx, req) => billing.cancelInvoice(ctx, id(req)));

  // ---------------------------------------------------------------- Ordonnances
  get("/rx", (ctx, req) => rx.listRx(ctx, qs(req, "status"), qn(req, "patientId")));
  get("/rx/queue", (ctx) => rx.printQueue(ctx));
  get("/rx/catalog", (ctx) => ({ medications: rx.medications(ctx), templates: rx.templates(ctx), maxItems: rx.MAX_ITEMS }));
  get("/rx/:id", (ctx, req) => rx.getRx(ctx, id(req)));
  post("/rx", (ctx, req) => rx.saveRx(ctx, req.body?.rx ?? {}, !!req.body?.send, !!req.body?.ack));
  post("/rx/:id/send", (ctx, req) => rx.sendRx(ctx, id(req)));
  post("/rx/:id/printed", (ctx, req) => rx.markPrinted(ctx, id(req)));
  post("/rx/:id/status", (ctx, req) => rx.setRxStatus(ctx, id(req), String(req.body?.status ?? "")));
  post("/rx/:id/duplicate", (ctx, req) => rx.duplicateRx(ctx, id(req)));
  post("/rx-templates", (ctx, req) => rx.saveTemplate(ctx, req.body?.name, req.body?.description, req.body?.items ?? []));
  del("/rx-templates/:id", (ctx, req) => rx.deleteTemplate(ctx, id(req)));

  // ---------------------------------------------------------------- Notifications, tableaux de bord, suivi
  get("/notifications", (ctx) => core.notificationsFor(db, ctx.user.id));
  post("/notifications/read", (ctx, req) => core.markRead(db, ctx.user.id, Number(req.body?.id) || undefined));
  get("/dashboard", (ctx) => stats.dashboard(ctx));
  get("/pilotage", (ctx, req) => ({ doctors: stats.doctorStats(ctx, qs(req, "from") ?? "", qs(req, "to") ?? ""), debtors: ctx.can(P.PilotageAll) ? stats.debtors(ctx) : [] }));
  get("/followup/cash", (ctx, req) => follow.cashJournal(ctx, qs(req, "day") ?? ""));
  get("/followup/recalls", (ctx) => follow.recalls(ctx));

  // ---------------------------------------------------------------- Administration (docteur principal)
  const principal = (ctx: Ctx) => ctx.requirePrincipal();
  get("/admin/users", (ctx) => {
    principal(ctx);
    const online = new Set(metrics.onlineUsers().map((o) => o.userId));
    return users.allUsers(db).map((u) => ({ ...publicUser(u), lockoutUntil: u.lockoutUntil, online: online.has(u.id) }));
  });
  post("/admin/users", (ctx, req) => users.createByAdmin(ctx, req.body ?? {}));
  post("/admin/users/:id/reset", (ctx, req) => ({ tempPassword: users.resetPassword(ctx, id(req)) }));
  post("/admin/users/:id/unlock", (ctx, req) => users.unlock(ctx, id(req)));
  post("/admin/users/:id/status", (ctx, req) => users.setStatus(ctx, id(req), String(req.body?.status ?? "")));
  post("/admin/users/:id/role", (ctx, req) => users.changeRole(ctx, id(req), String(req.body?.role ?? "")));
  post("/admin/users/:id/transfer", (ctx, req) => users.transferPrincipal(ctx, id(req)));

  get("/admin/permissions", (ctx) => {
    principal(ctx);
    return PermCatalog.map((p) => ({ ...p,
      values: { Docteur: hasPerm(db, Roles.Docteur, p.key), Secretaire: hasPerm(db, Roles.Secretaire, p.key) },
      custom: { Docteur: isCustomized(db, Roles.Docteur, p.key), Secretaire: isCustomized(db, Roles.Secretaire, p.key) } }));
  });
  post("/admin/permissions", (ctx, req) => {
    principal(ctx);
    const role = String(req.body?.role ?? ""), key = String(req.body?.key ?? ""), allowed = !!req.body?.allowed;
    if (role !== Roles.Docteur && role !== Roles.Secretaire) throw new BizError("Profil invalide.");
    const def = findPerm(key); if (!def) throw new BizError("Permission inconnue.");
    if (allowed && role === Roles.Secretaire && def.clinicalOnly) throw new BizError("Cet acte est réservé aux praticiens.");
    db.run(`INSERT INTO role_permissions(role, permission, allowed, updated_at, updated_by) VALUES(@role, @key, @allowed, @now, @uid)
      ON CONFLICT(role, permission) DO UPDATE SET allowed=excluded.allowed, updated_at=excluded.updated_at, updated_by=excluded.updated_by`,
      { role, key, allowed, now: new Date(), uid: ctx.user.id });
    loadPerms(db);
    audit(db, ctx.user, allowed ? "Permission accordée" : "Permission retirée", "permission", null, `${roleLabel(role)} · ${def.label}`);
    bus.emit("permissions");
  });
  post("/admin/permissions/reset", (ctx) => {
    principal(ctx);
    db.run("DELETE FROM role_permissions"); loadPerms(db);
    audit(db, ctx.user, "Permissions remises aux valeurs par défaut", "permission");
    bus.emit("permissions");
  });

  get("/admin/settings", (ctx) => { principal(ctx); return { settings: core.getSettings(db), canSeedDemo: demo.canSeed(ctx) }; });
  put("/admin/settings", (ctx, req) => { principal(ctx); const s = core.saveSettings(db, req.body ?? {}); audit(db, ctx.user, "Paramètres du cabinet modifiés", "settings"); return s; });
  post("/admin/acts", (ctx, req) => stats.saveAct(ctx, req.body ?? {}));
  get("/admin/medications", (ctx) => { ctx.require(P.CatalogMeds); return rx.medications(ctx, true); });
  post("/admin/medications", (ctx, req) => stats.saveMedication(ctx, req.body ?? {}));
  post("/admin/demo", (ctx) => ({ count: demo.seedDemo(ctx) }));

  get("/admin/backups", (ctx) => { principal(ctx); return { folder: backups.folder, files: backups.files() }; });
  post("/admin/backups", (ctx) => ({ file: stats.manualBackup(ctx, backups) }));
  r.get("/admin/backups/:name", auth, (req, res) => {
    try {
      req.ctx!.requirePrincipal();
      const p = backups.filePath(String(req.params.name)); if (!p) throw new BizError("Fichier introuvable.");
      audit(db, req.ctx!.user, "Téléchargement d'une sauvegarde", "backup", null, String(req.params.name));
      res.download(p);
    } catch (e) { sendError(res, e); }
  });
  get("/admin/logs", (ctx, req) => { principal(ctx); return log.search(500, (qs(req, "level") as any) || "debug", qs(req, "q")); });
  get("/admin/logs/files", (ctx) => { principal(ctx); return log.files(); });
  r.get("/admin/logs/files/:name", auth, (req, res) => {
    try { req.ctx!.requirePrincipal(); const p = log.filePath(String(req.params.name)); if (!p) throw new BizError("Fichier introuvable."); res.download(p); }
    catch (e) { sendError(res, e); }
  });
  get("/admin/audit", (ctx, req) => { principal(ctx); return core.searchAudit(db, qs(req, "q"), qs(req, "from"), qs(req, "to")); });
  get("/admin/supervision", (ctx, req) => {
    principal(ctx);
    const last = metrics.history[metrics.history.length - 1] ?? null;
    return {
      startedAt: metrics.startedAt, uptimeSec: Math.round((Date.now() - metrics.startedAt.getTime()) / 1000), history: metrics.history, last,
      online: metrics.onlineUsers(), tabs: metrics.online.size, requests: metrics.requests, r4xx: metrics.requests4xx, r5xx: metrics.requests5xx,
      avgLatencyMs: metrics.avgLatencyMs, dbBytes: db.sizeBytes(), errors: log.errors, warnings: log.warnings,
      loginSuccess: metrics.loginSuccess, loginFailure: metrics.loginFailure, rxSent: metrics.rxSent, rxPrinted: metrics.rxPrinted,
      lastBackup: backups.last(), routes: [...metrics.routes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      node: process.version, platform: `${process.platform} ${process.arch}`, host: os.hostname(), dataDir: path.dirname(db.file),
      dbCheck: (() => { try { return db.scalar("PRAGMA quick_check") === "ok"; } catch { return false; } })(),
      counts: Object.fromEntries(["patients", "appointments", "prescriptions", "invoices", "users", "audit_log"].map((t) => [t, db.scalar(`SELECT COUNT(*) FROM ${t}`)])), // noms de tables constants
      lanUrls: Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => `http://${i!.address}:${(req.socket.localPort ?? 5080)}`),
    };
  });
  return r;
}
