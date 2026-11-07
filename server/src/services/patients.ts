import type { Db } from "../db/db";
import { P, fmtDay } from "../../../shared/domain";
import { BizError, Ctx } from "../security/context";
import { audit } from "../security/audit";
import { nextNumber } from "./core";

/**
 * Dossiers patients. Règles :
 *  - nom, prénom, date de naissance, téléphone obligatoires ; contrôle des formats ;
 *  - doublon interdit (même nom + prénom + date de naissance) ;
 *  - pas de suppression : archivage, ou anonymisation RGPD ;
 *  - sans la permission « données médicales », antécédents / traitements / notes sont masqués (les allergies restent visibles).
 */
export interface PatientInput {
  id?: number; lastName?: string; firstName?: string; birthDate?: string; sex?: string; phone?: string; email?: string | null;
  address?: string | null; postalCode?: string | null; city?: string | null; ssn?: string | null; mutuelle?: string | null;
  allergies?: string | null; medicalHistory?: string | null; currentTreatments?: string | null; notes?: string | null; primaryDoctorId?: number | null;
}

const redact = (p: any, medical: boolean) => (medical ? p : { ...p, medicalHistory: null, currentTreatments: null, notes: null });

export function searchPatients(ctx: Ctx, q?: string, includeArchived = false, limit = 200) {
  const term = q?.trim().slice(0, 60) || null;
  const list = ctx.db.query(`SELECT * FROM patients
    WHERE (@inc = 1 OR archived = 0)
      AND (@term IS NULL OR last_name LIKE '%'||@term||'%' OR first_name LIKE '%'||@term||'%'
           OR (last_name||' '||first_name) LIKE '%'||@term||'%' OR (first_name||' '||last_name) LIKE '%'||@term||'%'
           OR phone LIKE '%'||@term||'%' OR file_no LIKE '%'||@term||'%')
    ORDER BY last_name, first_name LIMIT @limit`, { inc: includeArchived, term, limit: Math.min(limit, 500) });
  const med = ctx.can(P.PatientMedical);
  return list.map((p) => redact(p, med));
}

export function getPatient(ctx: Ctx, id: number) {
  const p = ctx.db.first("SELECT * FROM patients WHERE id=@id", { id });
  return p ? redact(p, ctx.can(P.PatientMedical)) : null;
}

const s = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function validatePatient(p: PatientInput, today = new Date()): string[] {
  const e: string[] = [];
  const ln = p.lastName ?? "", fn = p.firstName ?? "";
  if (ln.length < 1 || ln.length > 60) e.push("Nom obligatoire (60 caractères max).");
  if (fn.length < 1 || fn.length > 60) e.push("Prénom obligatoire (60 caractères max).");
  const bd = /^\d{4}-\d{2}-\d{2}$/.test(p.birthDate ?? "") ? p.birthDate! : "";
  const min = fmtDay(new Date(today.getFullYear() - 120, today.getMonth(), today.getDate()));
  if (!bd || bd > fmtDay(today) || bd < min) e.push("Date de naissance invalide.");
  if (!/^[0-9 +().-]{6,20}$/.test(p.phone ?? "")) e.push("Téléphone invalide.");
  if (!["F", "M", "X"].includes(p.sex ?? "")) e.push("Sexe invalide.");
  if (p.ssn && !/^[12][0-9]{12}([0-9]{2})?$/.test(p.ssn)) e.push("N° de sécurité sociale : 13 ou 15 chiffres.");
  if (p.postalCode && !/^\d{5}$/.test(p.postalCode)) e.push("Code postal : 5 chiffres.");
  if (p.email && !/^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(p.email)) e.push("Adresse e-mail invalide.");
  for (const [v, n] of [[p.allergies, "Allergies"], [p.medicalHistory, "Antécédents"], [p.notes, "Notes"], [p.currentTreatments, "Traitements"]] as const)
    if ((v?.length ?? 0) > 4000) e.push(`${n} : 4000 caractères maximum.`);
  return e;
}

export function savePatient(ctx: Ctx, input: PatientInput): number {
  ctx.require(P.PatientEdit);
  const medical = ctx.can(P.PatientMedical);
  let fn = String(input.firstName ?? "").trim();
  if (fn) fn = fn[0].toUpperCase() + fn.slice(1);
  const p = {
    id: Number(input.id) || 0, lastName: String(input.lastName ?? "").trim(), firstName: fn, birthDate: String(input.birthDate ?? ""),
    sex: String(input.sex ?? ""), phone: String(input.phone ?? "").trim(), email: s(input.email, 120),
    address: s(input.address, 120), postalCode: s(input.postalCode, 5), city: s(input.city, 60),
    ssn: s(input.ssn, 20)?.replace(/\s/g, "") ?? null, mutuelle: s(input.mutuelle, 80), allergies: s(input.allergies, 4001),
    medicalHistory: medical ? s(input.medicalHistory, 4001) : null, currentTreatments: medical ? s(input.currentTreatments, 4001) : null,
    notes: medical ? s(input.notes, 4001) : null, primaryDoctorId: Number(input.primaryDoctorId) || null,
  };
  const errs = validatePatient(p);
  if (errs.length) throw new BizError(errs.join(" "));
  const dup = ctx.db.scalar<number>(`SELECT COUNT(*) FROM patients WHERE lower(last_name)=lower(@lastName) AND lower(first_name)=lower(@firstName)
    AND birth_date=@birthDate AND id<>@id`, p);
  if (dup) throw new BizError("Un patient avec ces nom, prénom et date de naissance existe déjà.");
  const now = new Date();
  if (!p.id) {
    const fileNo = nextNumber(ctx.db, "P", false, 6);
    const id = ctx.db.run(`INSERT INTO patients(file_no,last_name,first_name,birth_date,sex,phone,email,address,postal_code,city,ssn,mutuelle,
        allergies,medical_history,current_treatments,notes,primary_doctor_id,created_at,updated_at)
      VALUES(@fileNo,@lastName,@firstName,@birthDate,@sex,@phone,@email,@address,@postalCode,@city,@ssn,@mutuelle,
        @allergies,@medicalHistory,@currentTreatments,@notes,@primaryDoctorId,@now,@now)`, { ...p, fileNo, now }).lastId;
    audit(ctx.db, ctx.user, "Création dossier patient", "patient", id);
    return id;
  }
  // Sans la permission médicale, on n'écrase pas les champs médicaux qu'on ne voit pas.
  ctx.db.run(`UPDATE patients SET last_name=@lastName, first_name=@firstName, birth_date=@birthDate, sex=@sex, phone=@phone, email=@email,
      address=@address, postal_code=@postalCode, city=@city, ssn=@ssn, mutuelle=@mutuelle, allergies=@allergies,
      ${medical ? "medical_history=@medicalHistory, current_treatments=@currentTreatments, notes=@notes," : ""}
      primary_doctor_id=@primaryDoctorId, updated_at=@now WHERE id=@id`, { ...p, now });
  audit(ctx.db, ctx.user, "Modification dossier patient", "patient", p.id);
  return p.id;
}

export function archivePatient(ctx: Ctx, id: number, archived: boolean) {
  ctx.require(P.PatientArchive);
  ctx.db.run("UPDATE patients SET archived=@archived, updated_at=@now WHERE id=@id", { archived, now: new Date(), id });
  audit(ctx.db, ctx.user, archived ? "Archivage dossier patient" : "Désarchivage dossier patient", "patient", id);
}

/** Droit à l'effacement (RGPD) : anonymisation irréversible, l'historique comptable est conservé. */
export function anonymizePatient(ctx: Ctx, id: number) {
  ctx.require(P.PatientAnonymize);
  ctx.db.run(`UPDATE patients SET last_name='ANONYME', first_name=file_no, phone='000000', email=NULL, address=NULL, postal_code=NULL, city=NULL,
      ssn=NULL, mutuelle=NULL, allergies=NULL, medical_history=NULL, current_treatments=NULL, notes=NULL, archived=1, updated_at=@now WHERE id=@id`, { now: new Date(), id });
  audit(ctx.db, ctx.user, "Anonymisation RGPD du dossier", "patient", id);
}

export const isValidTooth = (t: number) => Number.isInteger(t) && Math.floor(t / 10) >= 1 && Math.floor(t / 10) <= 4 && t % 10 >= 1 && t % 10 <= 8;
export type { Db };
