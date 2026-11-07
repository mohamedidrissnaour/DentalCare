import type { Db } from "../db/db";

/** Journal d'audit (qui a fait quoi, quand). Pas de données médicales dans `details`. */
export function audit(db: Db, user: { id: number; username: string } | null, action: string, entity?: string, entityId?: number | null, details?: string, ip?: string) {
  db.run("INSERT INTO audit_log(at,user_id,username,action,entity,entity_id,details,ip) VALUES(@at,@uid,@uname,@action,@entity,@entityId,@details,@ip)",
    { at: new Date(), uid: user?.id ?? null, uname: user?.username ?? null, action, entity: entity ?? null, entityId: entityId ?? null, details: details ?? null, ip: ip ?? null });
}
