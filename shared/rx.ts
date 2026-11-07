// Règles de validation d'une ordonnance (partagées : contrôle en direct dans l'interface, contrôle définitif sur le serveur).
export const MAX_ITEMS = 15;
export interface RxItem { medication: string; dosage?: string | null; frequency?: string | null; duration?: string | null; quantity?: string | null; instructions?: string | null }

export const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export function validateRx(notes: string | null, items: RxItem[], patient: { allergies?: string | null; [k: string]: unknown } | null) {
  const errors: string[] = [], warnings: string[] = [];
  if (!patient) errors.push("Choisissez un patient.");
  const lines = items.filter((i) => clean(i.medication));
  if (!lines.length) errors.push("Ajoutez au moins un médicament.");
  if (lines.length > MAX_ITEMS) errors.push(`${MAX_ITEMS} lignes maximum par ordonnance.`);
  for (const i of lines) {
    if (i.medication.length > 120) errors.push("Nom de médicament trop long.");
    if (!clean(i.dosage)) errors.push(`Posologie manquante pour « ${i.medication} ».`);
    if (!clean(i.duration)) errors.push(`Durée manquante pour « ${i.medication} ».`);
    if ([i.dosage, i.frequency, i.duration, i.quantity, i.instructions].some((f) => (f?.length ?? 0) > 200)) errors.push("Un champ dépasse 200 caractères.");
  }
  if ((notes?.length ?? 0) > 1000) errors.push("Remarques : 1000 caractères maximum.");
  const al = patient?.allergies?.trim();
  if (al) {
    const a = al.toLowerCase();
    for (const i of lines) {
      const m = i.medication.toLowerCase();
      const hit = ((a.includes("pénicilline") || a.includes("penicilline")) && (m.includes("amoxicilline") || m.includes("pénicilline")))
        || ((a.includes("ains") || a.includes("aspirine")) && (m.includes("ibuprofène") || m.includes("aspirine")))
        || (a.includes("codéine") && m.includes("codéine"))
        || a.split(/[,; \n]+/).some((w) => w.length > 4 && m.includes(w));
      if (hit) warnings.push(`Allergie déclarée « ${al} » : vérifiez « ${i.medication} ».`);
    }
  }
  return { errors, warnings };
}

