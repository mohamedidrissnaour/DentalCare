import { Logo } from "./Icon";
import { patientFullName, ageOf, userTitle, parseDt } from "../../../shared/domain";

/** Feuille d'ordonnance : en-tête du cabinet, titre souligné, praticien, lieu et date, corps, bandeau de pied. */
export function RxPaper({ cabinet, doctor, patient, date, items, notes, number, duplicate, mini }: {
  cabinet: any; doctor?: any; patient?: any; date: string; items: any[]; notes?: string | null; number?: string; duplicate?: boolean; mini?: boolean;
}) {
  const d = parseDt(date) ?? new Date();
  const lines = items.filter((i) => i.medication?.trim());
  return (
    <article className={"rx-paper" + (mini ? " mini" : "")}>
      <header className="rx-head">
        <div className="rx-brand"><Logo /><div><b>{cabinet.name}</b><small>Chirurgie dentaire</small></div></div>
        <div className="rx-doc">
          <b>{doctor ? userTitle(doctor) : "Dr …"}</b>
          <span>{doctor?.specialty ?? "Chirurgien-dentiste"}</span>
          {doctor?.rpps && <span>N° RPPS : {doctor.rpps}</span>}
        </div>
      </header>
      <h2 className="rx-title">ORDONNANCE</h2>
      <div className="rx-lines">
        <p><span>Docteur :</span> <b>{doctor?.fullName ?? ""}</b></p>
        <p className="rx-date">{cabinet.city ? cabinet.city + ", " : ""}le {d.toLocaleDateString("fr-FR")}</p>
      </div>
      <p className="rx-patient"><span>Patient :</span> <b>{patient ? patientFullName(patient) : "…"}</b>{patient && <small> ({ageOf(patient.birthDate)} ans)</small>}</p>
      <div className="rx-body">
        <ol>
          {lines.map((it, i) => (
            <li key={i}>
              <b>{it.medication}</b>
              <span>{[it.dosage, it.frequency].filter(Boolean).join(" ")}{it.duration ? ", pendant " + it.duration : ""}</span>
              {it.quantity && <em>Quantité : {it.quantity}</em>}
              {it.instructions && <em>{it.instructions}</em>}
            </li>
          ))}
        </ol>
        {notes && <p className="rx-notes">{notes}</p>}
      </div>
      <div className="rx-sign"><span>Signature et cachet</span></div>
      <footer className="rx-foot">
        <div className="rx-foot-band">
          {!cabinet.address && !cabinet.phone && <span>{cabinet.name}</span>}
          {cabinet.address && <span>{cabinet.address} {cabinet.postalCode} {cabinet.city}</span>}
          {cabinet.phone && <span>Tél : {cabinet.phone}</span>}
          {cabinet.fax && <span>Fax : {cabinet.fax}</span>}
          {cabinet.email && <span>{cabinet.email}</span>}
        </div>
        <div className="rx-foot-note"><span>{cabinet.rxFooter}</span><span>{number}{duplicate ? " · Duplicata" : ""}</span></div>
      </footer>
    </article>
  );
}
