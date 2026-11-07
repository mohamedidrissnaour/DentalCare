import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import { fmtDateTime } from "../../../shared/domain";
import { log } from "../obs/log";

type Params = object | undefined;
export type Row = Record<string, any>;

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Convertit les paramètres nommés { nom: valeur } en liaisons « @nom » (requêtes toujours paramétrées). */
function bind(params: Params): Record<string, SqlValue> | undefined {
  if (!params) return undefined;
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
    let val: SqlValue;
    if (v === undefined || v === null) val = null;
    else if (v instanceof Date) val = fmtDateTime(v);
    else if (typeof v === "boolean") val = v ? 1 : 0;
    else if (typeof v === "number" || typeof v === "string") val = v;
    else val = JSON.stringify(v);
    out["@" + k] = val;
  }
  return out;
}

/**
 * Base SQLite (moteur sql.js, WebAssembly : aucune compilation native à installer).
 * La base est en mémoire et enregistrée sur disque après chaque écriture (fichier temporaire puis renommage atomique).
 */
export class Db {
  private db!: Database;
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private txDepth = 0;
  constructor(public readonly file: string) {}

  static async open(file: string): Promise<Db> {
    const d = new Db(file);
    const wasm = require.resolve("sql.js/dist/sql-wasm.wasm").replace("app.asar" + path.sep, "app.asar.unpacked" + path.sep);
    const SQL = await initSqlJs({ locateFile: () => wasm });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    d.db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    d.db.run("PRAGMA foreign_keys = ON;");
    return d;
  }

  query<T = Row>(sql: string, params?: Params): T[] {
    const st = this.db.prepare(sql);
    try {
      const b = bind(params); if (b) st.bind(b);
      const rows: T[] = [];
      while (st.step()) {
        const r = st.getAsObject(); const o: Row = {};
        for (const k in r) o[camel(k)] = r[k];
        rows.push(o as T);
      }
      return rows;
    } finally { st.free(); }
  }

  first<T = Row>(sql: string, params?: Params): T | undefined { return this.query<T>(sql, params)[0]; }

  scalar<T = any>(sql: string, params?: Params): T | null {
    const st = this.db.prepare(sql);
    try {
      const b = bind(params); if (b) st.bind(b);
      return st.step() ? (st.get()[0] as T) : null;
    } finally { st.free(); }
  }

  run(sql: string, params?: Params): { changes: number; lastId: number } {
    const st = this.db.prepare(sql);
    try {
      const b = bind(params); if (b) st.bind(b);
      st.step();
    } finally { st.free(); }
    const changes = this.db.getRowsModified();
    const lastId = Number(this.db.exec("SELECT last_insert_rowid()")[0].values[0][0]);
    this.markDirty();
    return { changes, lastId };
  }

  exec(sql: string) { this.db.exec(sql); this.markDirty(); }

  /** Transaction : tout ou rien. Les transactions imbriquées rejoignent la transaction englobante. */
  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) { this.txDepth++; try { return fn(); } finally { this.txDepth--; } }
    this.db.exec("BEGIN IMMEDIATE");
    this.txDepth = 1;
    try { const r = fn(); this.db.exec("COMMIT"); return r; }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
    finally { this.txDepth = 0; this.markDirty(); }
  }

  private markDirty() {
    if (this.txDepth > 0) return;
    this.dirty = true;
    if (!this.saveTimer) this.saveTimer = setTimeout(() => { this.saveTimer = null; this.flush(); }, 250);
  }

  /** Écrit la base sur disque (atomique). */
  flush() {
    if (!this.dirty) return;
    const data = this.db.export();
    this.db.run("PRAGMA foreign_keys = ON;");
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, this.file);
    this.dirty = false;
  }

  /** Copie de sauvegarde cohérente vers un fichier. */
  backupTo(target: string) {
    const data = this.db.export();
    this.db.run("PRAGMA foreign_keys = ON;");
    fs.writeFileSync(target, data);
  }

  sizeBytes() { try { return fs.statSync(this.file).size; } catch { return 0; } }
  close() { try { this.flush(); } catch (e) { log.error("db", "Écriture finale impossible", e); } this.db.close(); }
}
