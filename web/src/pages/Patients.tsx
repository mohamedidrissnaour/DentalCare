import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "../lib/session";
import { api, qs } from "../lib/api";
import { Icon } from "../components/Icon";
import { PageHead } from "../components/ui";
import { PatientForm, emptyPatient } from "../components/PatientForm";
import { P, ageOf, patientFullName } from "../../../shared/domain";

export function Patients() {
  const { can } = useSession();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [archived, setArchived] = useState(false);
  const [list, setList] = useState<any[] | null>(null);
  const [form, setForm] = useState(params.get("nouveau") === "1" && can(P.PatientEdit));
  useEffect(() => { setQ(params.get("q") ?? ""); }, [params]);
  useEffect(() => {
    const t = setTimeout(() => api.get(`/patients${qs({ q, archived: archived ? 1 : null })}`).then(setList).catch(() => setList([])), 150);
    return () => clearTimeout(t);
  }, [q, archived]);
  return (
    <>
      <PageHead title="Patients" sub={`${list?.length ?? 0} dossier(s) ${q.trim() ? `pour « ${q.trim()} »` : ""}`}>
        <div className="search inline"><span className="search-ico"><Icon n="recherche" /></span>
          <input placeholder="Nom, prénom, téléphone, n° dossier…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} /></div>
        <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archivés</label>
        {can(P.PatientEdit) && <button className="btn btn-primary" onClick={() => setForm(true)}><Icon n="plus" /> Nouveau patient</button>}
      </PageHead>
      {list === null ? <div className="skeleton-list">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton"></div>)}</div>
        : !list.length ? (
          <div className="empty-state">
            <div className="empty-icon"><Icon n="dent" size={28} /></div><h2>Aucun patient trouvé</h2>
            <p className="muted">Créez le premier dossier ou modifiez votre recherche.</p>
            {can(P.PatientEdit) && <button className="btn btn-primary" onClick={() => setForm(true)}><Icon n="plus" /> Nouveau patient</button>}
          </div>
        ) : (
          <div className="patient-grid">
            {list.map((p, i) => (
              <Link key={p.id} className={"patient-card" + (p.archived ? " archived" : "")} to={`/patients/${p.id}`} style={{ ["--d" as any]: `${Math.min(i, 20) * 25}ms` }}>
                <span className={"avatar lg " + (p.sex === "F" ? "f" : "m")}>{p.firstName[0]}{p.lastName[0]}</span>
                <div className="pc-body">
                  <b>{patientFullName(p)}</b>
                  <small>{ageOf(p.birthDate)} ans · {p.fileNo}</small>
                  <small><Icon n="telephone" /> {p.phone}</small>
                  <div className="chips">
                    {p.allergies && <span className="chip chip-red"><Icon n="alerte" /> {p.allergies}</span>}
                    {p.noShowCount > 0 && <span className="chip chip-amber">{p.noShowCount} absence(s)</span>}
                    {p.mutuelle && <span className="chip">{p.mutuelle}</span>}
                    {!!p.archived && <span className="chip">archivé</span>}
                  </div>
                </div>
                <span className="pc-arrow">→</span>
              </Link>
            ))}
          </div>
        )}
      <PatientForm open={form} onClose={() => setForm(false)} model={emptyPatient()} onSaved={(id) => nav(`/patients/${id}`)} />
    </>
  );
}
