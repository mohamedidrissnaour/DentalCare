import fs from "node:fs";
import path from "node:path";
import { fmtDateTime, fmtDay } from "../../../shared/domain";

export type Level = "debug" | "info" | "warn" | "error";
export interface LogEntry { at: string; level: Level; category: string; message: string; exception?: string }
const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Journal applicatif : console + fichiers JSON Lines par jour (logs/dentacare-AAAAMMJJ.log) + mémoire récente.
 * Règle : aucun secret ni donnée personnelle de santé dans les messages (identifiants techniques seulement).
 */
class LogStore {
  private dir: string | null = null;
  private retention = 30;
  private recent: LogEntry[] = [];
  errors = 0; warnings = 0;

  init(dir: string, retentionDays: number) {
    this.dir = dir; this.retention = retentionDays;
    fs.mkdirSync(dir, { recursive: true });
    this.purge();
  }

  write(level: Level, category: string, message: string, err?: unknown) {
    const e: LogEntry = { at: fmtDateTime(new Date()), level, category, message };
    if (err) e.exception = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (level === "error") this.errors++; else if (level === "warn") this.warnings++;
    this.recent.push(e); if (this.recent.length > 2000) this.recent.shift();
    const line = `${e.at.slice(11)} ${level.toUpperCase().padEnd(5)} [${category}] ${message}${e.exception ? " | " + e.exception : ""}`;
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
    if (this.dir) {
      try { fs.appendFileSync(path.join(this.dir, `dentacare-${fmtDay(new Date()).replace(/-/g, "")}.log`), JSON.stringify(e) + "\n"); } catch { /* disque plein : la console suffit */ }
    }
  }
  debug(c: string, m: string) { this.write("debug", c, m); }
  info(c: string, m: string) { this.write("info", c, m); }
  warn(c: string, m: string, err?: unknown) { this.write("warn", c, m, err); }
  error(c: string, m: string, err?: unknown) { this.write("error", c, m, err); }

  search(max = 500, min: Level = "debug", q?: string): LogEntry[] {
    const s = q?.toLowerCase();
    return this.recent.filter((e) => order[e.level] >= order[min] && (!s || e.message.toLowerCase().includes(s) || e.category.toLowerCase().includes(s)))
      .slice(-max).reverse();
  }
  files(): { name: string; size: number; modified: string }[] {
    if (!this.dir) return [];
    return fs.readdirSync(this.dir).filter((f) => f.endsWith(".log")).map((f) => {
      const st = fs.statSync(path.join(this.dir!, f));
      return { name: f, size: st.size, modified: fmtDateTime(st.mtime) };
    }).sort((a, b) => b.name.localeCompare(a.name));
  }
  filePath(name: string): string | null {
    if (!this.dir || !/^dentacare-\d{8}\.log$/.test(name)) return null; // nom strict : pas de traversée de chemin
    const p = path.join(this.dir, name);
    return fs.existsSync(p) ? p : null;
  }
  private purge() {
    if (!this.dir) return;
    const limit = Date.now() - this.retention * 86400000;
    for (const f of fs.readdirSync(this.dir)) {
      const p = path.join(this.dir, f);
      try { if (f.endsWith(".log") && fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p); } catch { /* fichier verrouillé */ }
    }
  }
}
export const log = new LogStore();
