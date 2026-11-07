// Domaine partagé entre le serveur et l'interface : rôles, statuts, libellés, catalogue des permissions.

export const Roles = { Principal: "Principal", Docteur: "Docteur", Secretaire: "Secretaire" } as const;
export type Role = (typeof Roles)[keyof typeof Roles];
export const roleLabel = (r: string) => (r === "Principal" ? "Docteur principal" : r === "Docteur" ? "Docteur" : r === "Secretaire" ? "Secrétaire" : r);
export const isDoctor = (r: string) => r === "Principal" || r === "Docteur";

export const UserStatus = { Pending: "EnAttente", Active: "Actif", Disabled: "Desactive" } as const;

export const ApptStatus = {
  Planned: "Planifie", Confirmed: "Confirme", Arrived: "Arrive", InProgress: "EnCours",
  Done: "Termine", Cancelled: "Annule", NoShow: "Absent",
} as const;
export const apptStatusLabel = (s: string) =>
  ({ Planifie: "Planifié", Confirme: "Confirmé", Arrive: "En salle d'attente", EnCours: "En consultation", Termine: "Terminé", Annule: "Annulé", Absent: "Absent" } as Record<string, string>)[s] ?? s;
export const apptStatusCss = (s: string) =>
  ({ Planifie: "st-planned", Confirme: "st-confirmed", Arrive: "st-arrived", EnCours: "st-progress", Termine: "st-done", Annule: "st-cancelled", Absent: "st-noshow" } as Record<string, string>)[s] ?? "";
export const apptIsActive = (s: string) => s !== "Annule" && s !== "Absent";

export const InvoiceStatus = { Unpaid: "Impayee", Partial: "Partielle", Paid: "Payee", Cancelled: "Annulee" } as const;
export const invoiceStatusLabel = (s: string) =>
  ({ Impayee: "Impayée", Partielle: "Partiellement payée", Payee: "Payée", Annulee: "Annulée" } as Record<string, string>)[s] ?? s;

export const RxStatus = { Draft: "Brouillon", Sent: "Envoyee", Printed: "Imprimee", Delivered: "Remise", Cancelled: "Annulee" } as const;
export const rxStatusLabel = (s: string) =>
  ({ Brouillon: "Brouillon", Envoyee: "Envoyée au secrétariat", Imprimee: "Imprimée", Remise: "Remise au patient", Annulee: "Annulée" } as Record<string, string>)[s] ?? s;

export const VisitStatus = { Waiting: "EnAttente", InCare: "EnConsultation", Done: "Termine", Left: "Parti" } as const;
export const visitStatusLabel = (s: string) =>
  ({ EnAttente: "En attente", EnConsultation: "En consultation", Termine: "Terminé", Parti: "Parti sans soin" } as Record<string, string>)[s] ?? s;
export const visitStatusCss = (s: string) =>
  ({ EnAttente: "st-arrived", EnConsultation: "st-progress", Termine: "st-done", Parti: "st-cancelled" } as Record<string, string>)[s] ?? "";

export const PlanStatus = { Open: "EnCours", Done: "Termine", Dropped: "Abandonne" } as const;
export const planStatusLabel = (s: string) => ({ EnCours: "En cours", Termine: "Terminé", Abandonne: "Abandonné" } as Record<string, string>)[s] ?? s;
export const planStatusCss = (s: string) => ({ EnCours: "st-confirmed", Termine: "st-done", Abandonne: "st-cancelled" } as Record<string, string>)[s] ?? "";

export const PaymentMethods = ["CB", "Espèces", "Chèque", "Virement", "Tiers payant"] as const;

export const RecallKind = { NoShow: "absent", Plan: "plan", Checkup: "controle", Unpaid: "impaye" } as const;
export const RecallKinds: [string, string][] = [
  ["absent", "Absents sans nouveau RDV"], ["plan", "Traitements en cours sans RDV"],
  ["controle", "Contrôle annuel à prévoir"], ["impaye", "Reste à payer"],
];
export const recallLabel = (k: string) => RecallKinds.find((x) => x[0] === k)?.[1] ?? k;

// ------------------------------------------------------------------ Permissions
export const P = {
  QueueManage: "queue.manage", QueueCall: "queue.call", QueueDiagnosis: "queue.diagnosis",
  AgendaEdit: "agenda.edit", AgendaConsult: "agenda.consult",
  PatientEdit: "patients.edit", PatientMedical: "patients.medical", PatientArchive: "patients.archive", PatientAnonymize: "patients.anonymize",
  CareEdit: "care.edit", CareDelete: "care.delete",
  RxWrite: "rx.write", RxPrint: "rx.print", RxViewAll: "rx.viewall",
  BillingCollect: "billing.collect", BillingCancelPaid: "billing.cancelpaid",
  StatsRevenue: "stats.revenue", PilotageOwn: "pilotage.own", PilotageAll: "pilotage.all",
  CatalogMeds: "catalog.meds",
} as const;

export interface PermDef { key: string; group: string; label: string; help: string; docteur: boolean; secretaire: boolean; clinicalOnly?: boolean }

export const PermCatalog: PermDef[] = [
  { key: P.QueueManage, group: "File d'attente", label: "Enregistrer les arrivées et gérer la file", help: "Arrivée, nouveau patient, motif déclaré, urgence, attribution d'un praticien, retrait de la file", docteur: true, secretaire: true },
  { key: P.QueueCall, group: "File d'attente", label: "Appeler et terminer une consultation", help: "Fait passer le patient « en consultation » puis « terminé »", docteur: true, secretaire: false, clinicalOnly: true },
  { key: P.QueueDiagnosis, group: "File d'attente", label: "Corriger le motif (diagnostic)", help: "Remplace le motif déclaré à l'accueil par le motif constaté", docteur: true, secretaire: false },
  { key: P.AgendaEdit, group: "Agenda", label: "Créer et modifier des rendez-vous", help: "Prise de rendez-vous, déplacement, confirmation, annulation, absence", docteur: true, secretaire: true },
  { key: P.AgendaConsult, group: "Agenda", label: "Démarrer et terminer une consultation depuis l'agenda", help: "Statuts « en consultation » et « terminé »", docteur: true, secretaire: false, clinicalOnly: true },
  { key: P.PatientEdit, group: "Patients", label: "Créer et modifier les dossiers patients", help: "Identité, coordonnées, mutuelle, allergies", docteur: true, secretaire: true },
  { key: P.PatientMedical, group: "Patients", label: "Voir et modifier les données médicales", help: "Antécédents, traitements en cours, notes cliniques", docteur: true, secretaire: false },
  { key: P.PatientArchive, group: "Patients", label: "Archiver / désarchiver un dossier", help: "Un dossier archivé n'apparaît plus dans les recherches", docteur: true, secretaire: true },
  { key: P.PatientAnonymize, group: "Patients", label: "Anonymiser un dossier (RGPD)", help: "Effacement irréversible de l'identité et des données médicales", docteur: false, secretaire: false },
  { key: P.CareEdit, group: "Soins", label: "Saisir des soins et des traitements en plusieurs séances", help: "Soins réalisés, plans de traitement, séances", docteur: true, secretaire: false },
  { key: P.CareDelete, group: "Soins", label: "Supprimer un soin non facturé", help: "Correction d'une erreur de saisie", docteur: true, secretaire: false },
  { key: P.RxWrite, group: "Ordonnances", label: "Rédiger, envoyer et annuler des ordonnances", help: "Réservé aux praticiens (acte médical)", docteur: true, secretaire: false, clinicalOnly: true },
  { key: P.RxPrint, group: "Ordonnances", label: "Imprimer et remettre les ordonnances", help: "File d'impression, impression automatique, remise au patient", docteur: true, secretaire: true },
  { key: P.RxViewAll, group: "Ordonnances", label: "Voir les ordonnances de tous les praticiens", help: "Sinon : uniquement les siennes", docteur: false, secretaire: true },
  { key: P.BillingCollect, group: "Facturation", label: "Facturer et encaisser", help: "Création de facture, encaissement, annulation d'une facture non réglée", docteur: true, secretaire: true },
  { key: P.BillingCancelPaid, group: "Facturation", label: "Annuler une facture déjà encaissée", help: "Opération sensible tracée dans l'audit", docteur: false, secretaire: false },
  { key: P.StatsRevenue, group: "Indicateurs", label: "Voir les chiffres d'affaires", help: "Montants des actes et encaissements sur les tableaux de bord", docteur: true, secretaire: false },
  { key: P.PilotageOwn, group: "Indicateurs", label: "Voir ses propres indicateurs (pilotage)", help: "Activité personnelle du praticien", docteur: true, secretaire: false, clinicalOnly: true },
  { key: P.PilotageAll, group: "Indicateurs", label: "Voir les indicateurs de tous les praticiens", help: "Vue « Pilotage du cabinet » complète et impayés", docteur: false, secretaire: false },
  { key: P.CatalogMeds, group: "Référentiels", label: "Modifier le catalogue des médicaments", help: "Ajout et modification des médicaments proposés dans les ordonnances", docteur: true, secretaire: false },
];
export const findPerm = (k: string) => PermCatalog.find((p) => p.key === k);
export function permDefault(role: string, key: string): boolean {
  if (role === Roles.Principal) return true;
  const d = findPerm(key);
  if (!d) return false;
  return role === Roles.Docteur ? d.docteur : role === Roles.Secretaire && d.secretaire && !d.clinicalOnly;
}

// ------------------------------------------------------------------ Paramètres du cabinet
export interface CabinetSettings {
  name: string; address: string; postalCode: string; city: string; phone: string; fax: string; email: string; siret: string;
  /** Horaires par jour (0 = dimanche … 6 = samedi) : "08:30-12:30,14:00-19:00" ou vide = fermé. */
  hours: string[];
  slotMinutes: number; lateCancelHours: number; noShowAlertThreshold: number; backupRetentionDays: number;
  maintenanceMode: boolean; rxFooter: string;
}
export const defaultSettings = (): CabinetSettings => ({
  name: "Cabinet Dentaire", address: "", postalCode: "", city: "", phone: "", fax: "", email: "", siret: "",
  hours: ["", "08:30-12:30,14:00-19:00", "08:30-12:30,14:00-19:00", "08:30-12:30,14:00-19:00", "08:30-12:30,14:00-19:00", "08:30-12:30,14:00-18:00", "09:00-12:30"],
  slotMinutes: 15, lateCancelHours: 24, noShowAlertThreshold: 3, backupRetentionDays: 30, maintenanceMode: false,
  rxFooter: "En cas d'effet indésirable, arrêtez le traitement et contactez le cabinet.",
});

// ------------------------------------------------------------------ Dates locales « YYYY-MM-DDTHH:mm:ss » (même format en base et dans l'API)
const pad = (n: number) => String(n).padStart(2, "0");
export const fmtDateTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const fmtDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseDt(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}
export function ageOf(birth: string | null | undefined, today = new Date()): number | null {
  const b = parseDt(birth); if (!b) return null;
  let a = today.getFullYear() - b.getFullYear();
  const m = today.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < b.getDate())) a--;
  return a;
}
export const patientFullName = (p: { lastName: string; firstName: string }) => `${p.lastName.toUpperCase()} ${p.firstName}`;
export const userTitle = (u: { fullName: string; role: string }) => (isDoctor(u.role) ? `Dr ${u.fullName}` : u.fullName);
export const initials = (name: string) => name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
