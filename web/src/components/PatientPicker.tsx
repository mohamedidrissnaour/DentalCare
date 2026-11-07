import { useEffect, useState } from "react";
import { api, qs } from "../lib/api";
import { Icon } from "./Icon";
import { patientFullName, ageOf } from "../../../shared/domain";

/** Recherche de patient avec liste déroulante, puis affichage du patient choisi. */
export function PatientPicker({ patient, onPick, autoFocus }: { patient: any | null; onPick: (p: any | null) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const t = setTimeout(() => api.get(`/patients${qs({ q })}`).then((l) => setRes(l.slice(0, 8))).catch(() => setRes([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  if (patient) return (
    <div className="picked">
      <span className="avatar sm">{patient.firstName?.[0]}{patient.lastName?.[0]}</span>
      <b>{patientFullName(patient)}</b> <small>{ageOf(patient.birthDate)} ans · {patient.phone}</small>
      {patient.allergies && <span className="chip chip-red"><Icon n="alerte" /> {patient.allergies}</span>}
      <button type="button" className="link" onClick={() => onPick(null)}>changer</button>
    </div>
  );
  return (
    <div className="patient-search">
      <input placeholder="Tapez un nom, un téléphone…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} autoFocus={autoFocus} />
      {res.length > 0 && (
        <ul className="dropdown">
          {res.map((p) => (
            <li key={p.id} onClick={() => { onPick(p); setQ(""); setRes([]); }}>
              <b>{patientFullName(p)}</b> <small>{ageOf(p.birthDate)} ans · {p.phone} · {p.fileNo}</small>
              {p.allergies && <span className="chip chip-red"><Icon n="alerte" /> allergie</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
