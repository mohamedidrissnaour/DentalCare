import { useEffect, useState } from "react";
import { Modal, Alerts } from "./ui";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { useToasts } from "../lib/toasts";
import { P, patientFullName } from "../../../shared/domain";

export const emptyPatient = () => ({ id: 0, lastName: "", firstName: "", birthDate: "1990-01-01", sex: "F", phone: "", email: "", address: "", postalCode: "", city: "", ssn: "", mutuelle: "", allergies: "", medicalHistory: "", currentTreatments: "", notes: "", primaryDoctorId: "" as any });

/** Champs du dossier patient (réutilisés par l'accueil « nouveau patient »). */
export function PatientFields({ m, set, medical }: { m: any; set: (k: string, v: any) => void; medical: boolean }) {
  const { ref } = useSession();
  const inp = (k: string, extra: any = {}) => ({ value: m[k] ?? "", onChange: (e: any) => set(k, e.target.value), ...extra });
  return (
    <>
      <h4 className="section-title">Identité</h4>
      <div className="grid3">
        <label>Nom *<input {...inp("lastName", { maxLength: 60 })} /></label>
        <label>Prénom *<input {...inp("firstName", { maxLength: 60 })} /></label>
        <label>Date de naissance *<input type="date" {...inp("birthDate")} /></label>
        <label>Sexe<select {...inp("sex")}><option value="F">Femme</option><option value="M">Homme</option><option value="X">Autre</option></select></label>
        <label>Téléphone *<input {...inp("phone", { maxLength: 20, inputMode: "tel" })} /></label>
        <label>E-mail<input type="email" {...inp("email", { maxLength: 120 })} /></label>
        <label className="span2">Adresse<input {...inp("address", { maxLength: 120 })} /></label>
        <label>Code postal<input {...inp("postalCode", { maxLength: 5, inputMode: "numeric" })} /></label>
        <label>Ville<input {...inp("city", { maxLength: 60 })} /></label>
        <label>N° sécurité sociale<input {...inp("ssn", { maxLength: 21, inputMode: "numeric" })} /></label>
        <label>Mutuelle<input {...inp("mutuelle", { maxLength: 60 })} /></label>
        <label>Praticien référent
          <select value={m.primaryDoctorId ?? ""} onChange={(e) => set("primaryDoctorId", e.target.value)}>
            <option value="">-</option>
            {ref?.doctors.map((d) => <option key={d.id} value={d.id}>Dr {d.fullName}</option>)}
          </select>
        </label>
      </div>
      <h4 className="section-title">Santé</h4>
      <label><Icon n="alerte" /> Allergies (visibles par toute l'équipe)<textarea rows={2} {...inp("allergies", { maxLength: 4000, placeholder: "Pénicilline, latex, AINS…" })} /></label>
      {medical ? (
        <>
          <div className="grid2">
            <label>Antécédents médicaux<textarea rows={3} {...inp("medicalHistory", { maxLength: 4000 })} /></label>
            <label>Traitements en cours<textarea rows={3} {...inp("currentTreatments", { maxLength: 4000, placeholder: "Anticoagulants, bisphosphonates…" })} /></label>
          </div>
          <label>Notes cliniques (praticiens uniquement)<textarea rows={2} {...inp("notes", { maxLength: 4000 })} /></label>
        </>
      ) : <p className="hint"><Icon n="cadenas" /> Antécédents et notes cliniques : réservés aux praticiens.</p>}
    </>
  );
}

export function PatientForm({ open, onClose, model, onSaved }: { open: boolean; onClose: () => void; model: any; onSaved?: (id: number) => void }) {
  const { can } = useSession();
  const toasts = useToasts();
  const [m, setM] = useState<any>(model);
  const [err, setErr] = useState<string | null>(null);
  // Réinitialisé seulement à l'ouverture (pas à chaque rafraîchissement de la page en arrière-plan).
  useEffect(() => { if (open) { setM({ ...emptyPatient(), ...model }); setErr(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    try {
      const r = await api.post("/patients", m);
      toasts.success(m.id ? "Dossier mis à jour" : "Patient créé", patientFullName(m));
      onClose(); onSaved?.(r.id);
    } catch (e: any) { setErr(e.message); }
  };
  return (
    <Modal open={open} onClose={onClose} title={m?.id ? "Modifier le dossier" : "Nouveau patient"} wide
      footer={<><button className="btn" onClick={onClose}>Annuler</button><button className="btn btn-primary" onClick={save}><Icon n="sauvegarde" /> Enregistrer</button></>}>
      <div className="form">
        <PatientFields m={m} set={(k, v) => setM((x: any) => ({ ...x, [k]: v }))} medical={can(P.PatientMedical)} />
        <Alerts errors={err} />
      </div>
    </Modal>
  );
}
