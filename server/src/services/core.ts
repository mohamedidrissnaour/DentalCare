import type { Db } from "../db/db";
import { defaultSettings, type CabinetSettings, fmtDateTime } from "../../../shared/domain";
import { bus } from "../obs/bus";
import { log } from "../obs/log";
import { BizError } from "../security/context";

// ------------------------------------------------------------------ Paramètres du cabinet (JSON en base)
let settingsCache: CabinetSettings | null = null;
export function getSettings(db: Db): CabinetSettings {
  if (settingsCache) return settingsCache;
  const json = db.scalar<string>("SELECT value FROM settings WHERE key='cabinet'");
  settingsCache = { ...defaultSettings(), ...(json ? JSON.parse(json) : {}) };
  return settingsCache!;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, min: number, max: number, def: number) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : def; };

export function parseRanges(spec: string): [number, number][] | null {
  const out: [number, number][] = [];
  if (!spec || !spec.trim()) return out;
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(part);
    if (!m) return null;
    const a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
    if (+m[1] > 23 || +m[3] > 23 || +m[2] > 59 || +m[4] > 59 || b <= a) return null;
    out.push([a, b]);
  }
  return out;
}
/** Plages d'ouverture (minutes depuis minuit) d'un jour donné. */
export const openingRanges = (db: Db, day: Date) => parseRanges(getSettings(db).hours[day.getDay()] ?? "") ?? [];

export function saveSettings(db: Db, input: Partial<CabinetSettings>): CabinetSettings {
  const cur = getSettings(db);
  const hours = Array.isArray(input.hours) && input.hours.length === 7 ? input.hours.map((h) => str(h, 60)) : cur.hours;
  hours.forEach((h, i) => { if (parseRanges(h) === null) throw new BizError(`Horaires invalides (${["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"][i]}). Format : 08:30-12:30,14:00-19:00`); });
  const s: CabinetSettings = {
    name: str(input.name, 100) || cur.name, address: str(input.address, 120), postalCode: str(input.postalCode, 5), city: str(input.city, 60),
    phone: str(input.phone, 20), fax: str(input.fax, 20), email: str(input.email, 120), siret: str(input.siret, 14), hours,
    slotMinutes: [5, 10, 15, 20, 30].includes(Number(input.slotMinutes)) ? Number(input.slotMinutes) : cur.slotMinutes,
    lateCancelHours: int(input.lateCancelHours, 0, 168, cur.lateCancelHours),
    noShowAlertThreshold: int(input.noShowAlertThreshold, 1, 20, cur.noShowAlertThreshold),
    backupRetentionDays: int(input.backupRetentionDays, 1, 365, cur.backupRetentionDays),
    maintenanceMode: !!input.maintenanceMode, rxFooter: str(input.rxFooter, 300),
  };
  db.run("INSERT INTO settings(key,value) VALUES('cabinet',@v) ON CONFLICT(key) DO UPDATE SET value=excluded.value", { v: JSON.stringify(s) });
  settingsCache = s;
  bus.emit("settings");
  return s;
}

// ------------------------------------------------------------------ Numérotation : F-2026-00001, ORD-2026-00001, P-000001
export function nextNumber(db: Db, prefix: string, yearly = true, pad = 5): string {
  const key = yearly ? `${prefix}-${new Date().getFullYear()}` : prefix;
  return db.tx(() => {
    db.run("INSERT INTO counters(name,value) VALUES(@key,0) ON CONFLICT(name) DO NOTHING", { key });
    db.run("UPDATE counters SET value=value+1 WHERE name=@key", { key });
    const n = db.scalar<number>("SELECT value FROM counters WHERE name=@key", { key })!;
    return `${key}-${String(n).padStart(pad, "0")}`;
  });
}

// ------------------------------------------------------------------ Notifications (persistées + poussées en temps réel)
export interface Notif { kind: string; title: string; message: string; link?: string; entityId?: number; from?: string }

export function notifyUser(db: Db, userId: number, n: Notif, role: string | null = null) {
  const { lastId } = db.run(`INSERT INTO notifications(user_id,target_role,kind,title,message,link,entity_id,created_at,created_by_name)
    VALUES(@userId,@role,@kind,@title,@message,@link,@entityId,@now,@from)`,
    { userId, role, kind: n.kind, title: n.title, message: n.message, link: n.link ?? null, entityId: n.entityId ?? null, now: new Date(), from: n.from ?? null });
  log.info("notification", `Notification ${n.kind} #${lastId} → utilisateur ${userId}`);
  bus.emit("notifications", { id: lastId, kind: n.kind, title: n.title, message: n.message, link: n.link ?? null }, { userIds: [userId] });
}
export function notifyRole(db: Db, role: string, n: Notif) {
  for (const u of db.query<{ id: number }>("SELECT id FROM users WHERE role=@role AND status='Actif'", { role })) notifyUser(db, u.id, n, role);
}
export const notificationsFor = (db: Db, userId: number, limit = 50) =>
  db.query("SELECT * FROM notifications WHERE user_id=@userId ORDER BY id DESC LIMIT @limit", { userId, limit });
export const unreadCount = (db: Db, userId: number) =>
  db.scalar<number>("SELECT COUNT(*) FROM notifications WHERE user_id=@userId AND read_at IS NULL", { userId }) ?? 0;
export function markRead(db: Db, userId: number, id?: number) {
  if (id) db.run("UPDATE notifications SET read_at=@now WHERE id=@id AND user_id=@userId AND read_at IS NULL", { now: new Date(), id, userId });
  else db.run("UPDATE notifications SET read_at=@now WHERE user_id=@userId AND read_at IS NULL", { now: new Date(), userId });
  bus.emit("notifications", { read: true }, { userIds: [userId] });
}
export function markEntityRead(db: Db, kind: string, entityId: number) {
  db.run("UPDATE notifications SET read_at=@now WHERE kind=@kind AND entity_id=@entityId AND read_at IS NULL", { now: new Date(), kind, entityId });
  bus.emit("notifications", { read: true });
}

// ------------------------------------------------------------------ Audit (recherche)
export function searchAudit(db: Db, q?: string, from?: string, to?: string, limit = 300) {
  return db.query(`SELECT * FROM audit_log
    WHERE (@q IS NULL OR action LIKE '%'||@q||'%' OR username LIKE '%'||@q||'%' OR entity LIKE '%'||@q||'%')
      AND (@from IS NULL OR at >= @from) AND (@to IS NULL OR at < @to)
    ORDER BY id DESC LIMIT @limit`, { q: q?.trim() || null, from: from || null, to: to || null, limit });
}

export const nowStr = () => fmtDateTime(new Date());
