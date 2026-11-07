import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import express, { type Request, type Response, type NextFunction } from "express";
import type { Server } from "node:http";
import { Db } from "./db/db";
import { migrate } from "./db/schema";
import { log } from "./obs/log";
import { metrics } from "./obs/metrics";
import { bus } from "./obs/bus";
import { ensureInitialAccounts, resetFromConsole } from "./security/initial";
import { sessionUser, purgeSessions } from "./security/sessions";
import { apiRouter } from "./routes/api";
import { Backups } from "./services/stats";
import { selfTest } from "./selftest";

export interface Options { dataDir: string; port: number; host: string; webDir: string }

/** Dossier de données : DENTACARE_DATA, sinon ./app-data, sinon celui de l'application de bureau (%APPDATA%\DentaCare\data). */
function defaultDataDir() {
  if (process.env.DENTACARE_DATA) return path.resolve(process.env.DENTACARE_DATA);
  const local = path.join(process.cwd(), "app-data");
  const desktop = process.env.APPDATA ? path.join(process.env.APPDATA, "DentaCare", "data") : null;
  if (!fs.existsSync(local) && desktop && fs.existsSync(path.join(desktop, "dentacare.db"))) return desktop;
  return local;
}

export function defaultOptions(): Options {
  return {
    dataDir: defaultDataDir(),
    port: Number(process.env.DENTACARE_PORT) || 5080,
    host: process.env.DENTACARE_HOST || "0.0.0.0",
    webDir: path.resolve(__dirname, "..", "web"),
  };
}

export async function openDb(dataDir: string) {
  fs.mkdirSync(dataDir, { recursive: true });
  log.init(path.join(dataDir, "logs"), 30);
  const db = await Db.open(path.join(dataDir, "dentacare.db"));
  migrate(db);
  return db;
}

/** Démarre le serveur DentaCare (API + interface) ; utilisé par Electron (poste serveur) et par « npm run serve ». */
export async function startServer(opts: Options = defaultOptions()): Promise<{ server: Server; db: Db; url: string; stop: () => Promise<void> }> {
  const db = await openDb(opts.dataDir);
  ensureInitialAccounts(db, opts.dataDir);
  const backups = new Backups(db, path.join(opts.dataDir, "backups"));
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", false);

  // En-têtes de sécurité : aucune ressource externe, pas d'intégration dans un cadre tiers.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  // Télémétrie : route normalisée (sans identifiants), statut, durée.
  app.use((req, res, next) => {
    const t = process.hrtime.bigint();
    res.on("finish", () => {
      if (req.path === "/api/events") return;
      const route = req.path.replace(/\/\d+(?=\/|$)/g, "/:id");
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      metrics.track(`${req.method} ${route}`, res.statusCode, ms);
      if (res.statusCode >= 500) log.warn("http", `${req.method} ${route} → ${res.statusCode} (${ms.toFixed(0)} ms)`);
    });
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => { res.json({ status: "ok", uptimeSec: Math.round((Date.now() - metrics.startedAt.getTime()) / 1000) }); });
  app.get("/metrics", (req, res) => {
    const u = sessionUser(db, req);
    if (!u || u.role !== "Principal") { res.status(403).send("Accès refusé"); return; }
    res.type("text/plain").send(metrics.prometheus(db.sizeBytes()));
  });
  app.use("/api", apiRouter(db, backups));
  app.use("/api", (_req, res) => { res.status(404).json({ error: "Introuvable." }); });

  // Interface React (application monopage).
  if (fs.existsSync(opts.webDir)) {
    app.use(express.static(opts.webDir, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => { res.sendFile(path.join(opts.webDir, "index.html")); });
  }

  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(opts.port, opts.host, () => resolve(s));
    s.on("error", reject);
  });
  const timers = [
    setInterval(() => metrics.sample(), 5000),
    setInterval(() => bus.heartbeat(), 20000),
    setInterval(() => { backups.tick(); purgeSessions(db); }, 3600000),
  ];
  setTimeout(() => backups.tick(), 20000);
  metrics.sample();

  const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  const url = `http://localhost:${opts.port}`;
  log.info("serveur", `DentaCare démarré : ${url}${lan && opts.host === "0.0.0.0" ? ` (réseau : http://${lan}:${opts.port})` : ""} · données : ${opts.dataDir}`);

  const stop = async () => {
    timers.forEach(clearInterval);
    await new Promise<void>((r) => server.close(() => r()));
    db.close();
  };
  return { server, db, url, stop };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--selftest")) { process.exit(await selfTest()); }
  const i = args.indexOf("--reset-password");
  if (i >= 0) {
    console.log(`Dossier de données : ${defaultOptions().dataDir}`);
    const db = await openDb(defaultOptions().dataDir);
    const code = resetFromConsole(db, args[i + 1] ?? "docteur");
    db.close();
    process.exit(code);
  }
  const s = await startServer();
  const shutdown = () => { log.info("serveur", "Arrêt demandé"); s.stop().finally(() => process.exit(0)); };
  process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
}

if (require.main === module) main().catch((e) => { log.error("serveur", "Démarrage impossible", e); process.exit(1); });
