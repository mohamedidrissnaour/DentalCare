import type { Response } from "express";
import { metrics } from "./metrics";
import { fmtDateTime } from "../../../shared/domain";

/**
 * Événements temps réel vers les postes connectés (Server-Sent Events) :
 * file d'attente, agenda, ordonnances, notifications, permissions. Aucun contenu médical : seulement « quoi a changé ».
 */
export type Topic = "visits" | "appointments" | "prescriptions" | "notifications" | "permissions" | "users" | "settings";
interface Client { id: string; userId: number; role: string; res: Response }

class Bus {
  private clients = new Map<string, Client>();
  private seq = 0;

  add(userId: number, userName: string, role: string, res: Response) {
    const id = String(++this.seq);
    this.clients.set(id, { id, userId, role, res });
    const now = fmtDateTime(new Date());
    metrics.online.set(id, { id, userId, userName, role, connectedAt: now, lastSeen: now });
    res.on("close", () => { this.clients.delete(id); metrics.online.delete(id); });
    return id;
  }

  /** Diffuse un changement. `userIds`/`roles` limitent les destinataires (notifications ciblées). */
  emit(topic: Topic, data: Record<string, unknown> = {}, target?: { userIds?: number[]; roles?: string[] }) {
    const payload = `event: ${topic}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of this.clients.values()) {
      if (target && !(target.userIds?.includes(c.userId) || target.roles?.includes(c.role))) continue;
      try { c.res.write(payload); } catch { /* client parti */ }
    }
  }

  /** Coupe les connexions d'un utilisateur (compte désactivé, mot de passe changé). */
  kick(userId: number) {
    for (const c of this.clients.values()) if (c.userId === userId) { c.res.write("event: logout\ndata: {}\n\n"); c.res.end(); }
  }

  heartbeat() {
    for (const c of this.clients.values()) {
      try { c.res.write(": ping\n\n"); const o = metrics.online.get(c.id); if (o) o.lastSeen = fmtDateTime(new Date()); } catch { /* ignoré */ }
    }
  }
}
export const bus = new Bus();
