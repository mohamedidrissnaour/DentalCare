import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSession, useLive } from "../lib/session";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { useToasts } from "../lib/toasts";
import { Icon } from "../components/Icon";
import { Modal, Alerts, PageLoader, PageHead } from "../components/ui";
import { PhoneDialog } from "../components/PhoneDialog";
import { emptyPatient } from "../components/PatientForm";
import { money, dTime, dDate, dDayTime } from "../lib/format";
import { P, ageOf, parseDt, patientFullName, visitStatusCss, visitStatusLabel } from "../../../shared/domain";

const PRIORITY_WINDOW_MIN = 5;
const minutes = (a: string | null | undefined, b: Date = new Date()) => { const d = parseDt(a); return d ? Math.floor((b.getTime() - d.getTime()) / 60000) : 0; };
const waitMin = (v: any) => {
  const end = parseDt(v.startedAt) ?? (v.status === "EnAttente" ? new Date() : parseDt(v.endedAt) ?? new Date());
  return minutes(v.arrivedAt, end);
};

export function Queue() {
  const { me, can, ref } = useSession();
  const toasts = useToasts();
  const q = useApi<any>("/queue");
  const [open, setOpen] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ treatments: any[]; plans: any[] } | null>(null);
  const [phone, setPhone] = useState<any>(null);
  const [arrival, setArrival] = useState(false);
  const [diag, setDiag] = useState<any>(null); const [diagText, setDiagText] = useState("");
  const [, tick] = useState(0);
  useLive(["visits", "appointments"], () => { q.reload(); if (open) loadDetail(open); });
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  if (!q.data || !me) return <PageLoader />;
  const list: any[] = q.data.visits, expected: any[] = q.data.expected;
  const canCall = can(P.QueueCall), canManage = can(P.QueueManage);
  const active = list.filter((v) => v.status === "EnAttente" || v.status === "EnConsultation");
  const done = list.filter((v) => v.status === "Termine" || v.status === "Parti");
  const currentId = active.find((v) => v.status === "EnConsultation" && v.doctorId === me.id)?.id ?? active.find((v) => v.status === "EnConsultation")?.id ?? active[0]?.id;
  const waits = list.filter((v) => v.startedAt).map(waitMin);
  const avg = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0;
  const busy = active.some((x) => x.status === "EnConsultation" && x.doctorId === me.id);

  async function loadDetail(id: number) {
    const v = list.find((x) => x.id === id) ?? q.data?.visits.find((x: any) => x.id === id);
    if (!v) return;
    const d = await api.get(`/patients/${v.patientId}/dossier`);
    setDetail({ treatments: d.treatments.slice(0, 8), plans: d.plans });
  }
  const toggle = (v: any) => { if (open === v.id) { setOpen(null); return; } setOpen(v.id); setDetail(null); loadDetail(v.id); };
  const act = async (url: string, body: any, ok: string) => {
    try { await api.post(url, body); toasts.success(ok); q.reload(); } catch (e: any) { toasts.error("Action impossible", e.message); }
  };
  const arrived = async (a: any) => {
    try {
      const r = await api.post("/queue/arrival", { patientId: a.patientId, complaint: a.reason, urgent: false, doctorId: a.doctorId });
      r.warnings?.forEach((w: string) => toasts.show("info", w));
      toasts.success("Patient ajouté à la file d'attente", a.patientName); q.reload();
    } catch (e: any) { toasts.error("Action impossible", e.message); }
  };

  const Detail = ({ v }: { v: any }) => (
    <div className="q-detail-body">
      <div>
        <h4>Dernières consultations et soins</h4>
        {!detail ? <p className="muted">Chargement…</p> : !detail.treatments.length ? <p className="muted">Aucun soin enregistré pour ce patient.</p> : (
          <table className="table compact">
            <thead><tr><th>Date</th><th>Soin</th><th>Dent</th><th>Séance</th><th>Praticien</th><th className="num">Montant</th><th>Facturé</th></tr></thead>
            <tbody>{detail.treatments.map((t) => (
              <tr key={t.id}><td className="num-l">{dDate(t.performedAt)}</td><td>{t.label}</td><td>{t.tooth ?? "-"}</td>
                <td>{t.sessionNo ? `${t.sessionNo}/${t.planSessions}` : "-"}</td><td>Dr {t.doctorName}</td><td className="num">{money(t.price)}</td><td>{t.invoiceId ? "oui" : "à facturer"}</td></tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div>
        <h4>Traitements en plusieurs séances</h4>
        {detail && !detail.plans.some((p) => p.status === "EnCours") && <p className="muted">Aucun traitement en cours.</p>}
        {detail?.plans.filter((p) => p.status === "EnCours").map((p) => (
          <div className="plan-line" key={p.id}>
            <div><b>{p.label}</b>{p.tooth && <span className="muted"> · dent {p.tooth}</span>}<small className="block muted">Dr {p.doctorName} · dernière séance {p.lastSession ? dDayTime(p.lastSession).slice(0, 5) : "-"}</small></div>
            <div className="plan-progress"><span className="num-l">{p.sessionsDone}/{p.sessionsPlanned} séances</span><div className="meter"><i style={{ width: `${Math.min(100, Math.floor((p.sessionsDone * 100) / p.sessionsPlanned))}%` }}></i></div></div>
          </div>
        ))}
        <div className="q-detail-actions">
          <Link className="btn btn-sm" to={`/patients/${v.patientId}`}><Icon n="patients" /> Dossier complet</Link>
          {can(P.QueueDiagnosis) && <button className="btn btn-sm" onClick={() => { setDiag(v); setDiagText(v.diagnosis ?? v.complaint ?? ""); }}><Icon n="crayon" /> Corriger le motif</button>}
          {can(P.CareEdit) && <Link className="btn btn-sm" to={`/patients/${v.patientId}?soin=1`}><Icon n="consultation" /> Saisir un soin</Link>}
          {can(P.RxWrite) && <Link className="btn btn-sm" to={`/ordonnances/nouvelle?patient=${v.patientId}`}><Icon n="ordonnance" /> Ordonnance</Link>}
          {v.remaining > 0 && can(P.BillingCollect) && <Link className="btn btn-sm" to={`/facturation?patient=${v.patientId}`}><Icon n="euro" /> Encaisser</Link>}
          {canManage && v.status === "EnAttente" && <>
            <button className="btn btn-sm" onClick={() => act(`/queue/${v.id}/priority`, { urgent: !v.priority }, v.priority ? "Urgence retirée" : "Marqué urgent")}>{v.priority ? "Retirer l'urgence" : "Marquer urgent"}</button>
            <select className="inline-select" value={v.doctorId ?? ""} onChange={(e) => act(`/queue/${v.id}/doctor`, { doctorId: Number(e.target.value) || null }, "Praticien attribué")}>
              <option value="">Praticien : non attribué</option>
              {ref?.doctors.map((d) => <option key={d.id} value={d.id}>Dr {d.fullName}</option>)}
            </select>
            <button className="btn btn-sm btn-danger-ghost" onClick={() => act(`/queue/${v.id}/leave`, { reason: "Retiré par l'accueil" }, "Patient retiré de la file")}>Retirer de la file</button>
          </>}
          {canCall && v.status === "EnConsultation" && <button className="btn btn-sm" onClick={() => act(`/queue/${v.id}/back`, {}, "Patient remis en attente")}>Remettre en attente</button>}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PageHead title="File d'attente" sub={`${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · mise à jour en temps réel sur tous les postes`}>
        {canManage && <button className="btn btn-primary" onClick={() => setArrival(true)}><Icon n="plus" /> Enregistrer une arrivée</button>}
      </PageHead>
      <section className="kpis">
        <div className="kpi kpi-ico"><span className="kpi-icon blue"><Icon n="salle-attente" size={20} /></span><div><small>En attente</small><b>{list.filter((v) => v.status === "EnAttente").length}</b></div></div>
        <div className="kpi kpi-ico"><span className="kpi-icon green"><Icon n="consultation" size={20} /></span><div><small>En consultation</small><b>{list.filter((v) => v.status === "EnConsultation").length}</b></div></div>
        <div className="kpi kpi-ico"><span className="kpi-icon gray"><Icon n="valide" size={20} /></span><div><small>Terminés aujourd'hui</small><b>{list.filter((v) => v.status === "Termine").length}</b></div></div>
        <div className="kpi kpi-ico"><span className="kpi-icon blue"><Icon n="horloge" size={20} /></span><div><small>Attente moyenne</small><b>{avg} min</b></div></div>
      </section>

      {expected.length > 0 && (
        <div className="card flush expected-card">
          <header className="card-head"><h3>Rendez-vous attendus</h3><span className="muted">patients avec rendez-vous pas encore arrivés</span></header>
          <table className="table">
            <thead><tr><th style={{ width: 80 }}>RDV</th><th>Patient</th><th>Acte</th><th>Praticien</th><th>Statut</th><th style={{ width: "1%" }}></th></tr></thead>
            <tbody>{expected.map((a) => {
              const late = minutes(a.startAt);
              return (
                <tr key={a.id} className={late > 0 ? "row-late" : ""}>
                  <td className="num-l strong">{dTime(a.startAt)}</td>
                  <td><Link to={`/patients/${a.patientId}`} className="strong">{a.patientName}</Link><small className="block muted">{a.patientPhone}</small></td>
                  <td><span className="act-dot" style={{ background: a.actColor ?? a.doctorColor }}></span>{a.actLabel ?? a.reason}</td>
                  <td><span className="doc-tag" style={{ ["--c" as any]: a.doctorColor }}>Dr {a.doctorName}</span></td>
                  <td><div className="status-with-action">
                    {late > 0 ? <span className="status st-noshow">En retard de {late} min</span> : <span className="status st-confirmed">Attendu dans {-late} min</span>}
                    <button className="phone-btn ring" title="Appeler le patient" onClick={() => setPhone(a)}><Icon n="telephone" /></button>
                  </div></td>
                  <td><div className="row-actions">
                    {canManage && <button className="btn btn-sm btn-primary" onClick={() => arrived(a)}>Arrivé</button>}
                    {late > 0 && can(P.AgendaEdit) && <button className="btn btn-sm btn-ghost" onClick={() => act(`/appointments/${a.id}/status`, { to: "Absent" }, "Patient marqué absent")}>Absent</button>}
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}

      <div className="card flush">
        <header className="card-head"><h3>Patients au cabinet</h3><span className="muted">{active.length} patient(s)</span></header>
        {!active.length ? <div className="empty-mini">Personne en salle d'attente. Cliquez sur « Enregistrer une arrivée » à l'accueil d'un patient.</div> : (
          <table className="table queue-grid">
            <thead><tr><th style={{ width: 56 }}>N°</th><th>Patient</th><th>Arrivée</th><th>Motif</th><th>Praticien</th><th>Historique</th><th className="num">Payé</th><th className="num">Reste dû</th><th>Statut</th><th style={{ width: "1%" }}></th></tr></thead>
            <tbody>{active.flatMap((v) => {
              const w = waitMin(v), age = ageOf(v.birthDate), soon = new Date(Date.now() + PRIORITY_WINDOW_MIN * 60000);
              const rdv = parseDt(v.apptStart);
              const rows = [
                <tr key={v.id} className={["q-row", v.id === currentId && "q-current", v.priority > 0 && "q-urgent", open === v.id && "q-open"].filter(Boolean).join(" ")} onClick={() => toggle(v)}>
                  <td><span className="q-num">{v.queueNo}</span></td>
                  <td><div className="q-patient">
                    <b>{v.patientName}</b><small>{age !== null ? `${age} ans · ` : ""}{v.fileNo}</small>
                    <div className="chips">
                      {v.visitCount <= 1 && <span className="chip chip-blue">Nouveau patient</span>}
                      {v.priority > 0 && <span className="chip chip-red">Urgent</span>}
                      {v.status === "EnAttente" && rdv && (rdv <= soon ? <span className="chip chip-green">RDV {dTime(v.apptStart)} · prioritaire</span> : <span className="chip chip-blue">RDV à {dTime(v.apptStart)}</span>)}
                      {v.allergies && <span className="chip chip-red"><Icon n="alerte" /> {v.allergies}</span>}
                    </div>
                  </div></td>
                  <td className="num-l">{dTime(v.arrivedAt)}<small className={"block " + (v.status === "EnAttente" && w > 20 ? "late" : "muted")}>{v.status === "EnAttente" ? `attend depuis ${w} min` : `attente ${w} min`}</small></td>
                  <td className="q-reason">{v.diagnosis ? <><b>{v.diagnosis}</b>{v.complaint && <small className="block muted">Déclaré : {v.complaint}</small>}</> :
                    <><span>{v.complaint ?? v.apptLabel ?? "-"}</span><small className="block muted">{v.appointmentId ? `RDV de ${dTime(v.apptStart)}` : "Sans rendez-vous"} · motif déclaré</small></>}</td>
                  <td>{v.doctorName ? <span className="doc-tag" style={{ ["--c" as any]: v.doctorColor }}>Dr {v.doctorName}</span> : <span className="muted">Non attribué</span>}</td>
                  <td><span>{v.visitCount <= 1 ? "1er passage" : `${v.visitCount} passages`}</span><small className="block muted">{v.lastVisit ? `dernier : ${dDate(v.lastVisit)}` : "-"}{v.openPlans > 0 ? ` · ${v.openPlans} soin(s) en cours` : ""}</small></td>
                  <td className="num">{money(v.totalPaid)}</td>
                  <td className={"num" + (v.remaining > 0 ? " money-due" : "")}>{money(v.remaining)}</td>
                  <td><span className={`status ${visitStatusCss(v.status)}`}>{visitStatusLabel(v.status)}</span></td>
                  <td onClick={(e) => e.stopPropagation()}><div className="row-actions">
                    {canCall && v.status === "EnAttente" && <button className="btn btn-sm btn-primary" disabled={busy} title={busy ? "Terminez d'abord votre consultation en cours" : "Appeler ce patient"} onClick={() => act(`/queue/${v.id}/call`, {}, `${v.patientName} appelé(e) en consultation`)}>Appeler</button>}
                    {canCall && v.status === "EnConsultation" && <button className="btn btn-sm btn-success" onClick={() => act(`/queue/${v.id}/finish`, {}, "Consultation terminée")}>Terminer</button>}
                    <button className="icon-btn" title="Détails" onClick={() => toggle(v)}><Icon n={open === v.id ? "chevron-bas" : "chevron"} /></button>
                  </div></td>
                </tr>,
              ];
              if (open === v.id) rows.push(<tr key={v.id + "d"} className="q-detail"><td colSpan={10}><Detail v={v} /></td></tr>);
              return rows;
            })}</tbody>
          </table>
        )}
      </div>

      {done.length > 0 && (
        <div className="card flush">
          <header className="card-head"><h3>Passages terminés aujourd'hui</h3><span className="muted">{done.length}</span></header>
          <table className="table">
            <thead><tr><th style={{ width: 56 }}>N°</th><th>Patient</th><th>Arrivée</th><th>Motif</th><th>Praticien</th><th>Durée</th><th className="num">Reste dû</th><th>Statut</th></tr></thead>
            <tbody>{done.flatMap((v) => {
              const s = parseDt(v.startedAt), e = parseDt(v.endedAt);
              const rows = [
                <tr key={v.id} className="clickable" onClick={() => toggle(v)}>
                  <td><span className="q-num muted-num">{v.queueNo}</span></td>
                  <td><Link to={`/patients/${v.patientId}`} onClick={(ev) => ev.stopPropagation()} className="strong">{v.patientName}</Link></td>
                  <td className="num-l">{dTime(v.arrivedAt)}</td>
                  <td>{v.diagnosis || v.complaint || v.apptLabel || "-"}</td>
                  <td>{v.doctorName ? "Dr " + v.doctorName : "-"}</td>
                  <td className="num-l">{s && e ? `${Math.floor((e.getTime() - s.getTime()) / 60000)} min` : "-"}</td>
                  <td className={"num" + (v.remaining > 0 ? " money-due" : "")}>{money(v.remaining)}</td>
                  <td><span className={`status ${visitStatusCss(v.status)}`}>{visitStatusLabel(v.status)}</span></td>
                </tr>,
              ];
              if (open === v.id) rows.push(<tr key={v.id + "d"} className="q-detail"><td colSpan={8}><Detail v={v} /></td></tr>);
              return rows;
            })}</tbody>
          </table>
        </div>
      )}

      <PhoneDialog open={!!phone} onClose={() => setPhone(null)} name={phone?.patientName ?? ""} phone={phone?.patientPhone}
        subtitle={phone ? `Rendez-vous à ${dTime(phone.startAt)} avec Dr ${phone.doctorName}` : null} />
      <ArrivalModal open={arrival} onClose={() => setArrival(false)} onDone={() => { setArrival(false); q.reload(); }} />
      <Modal open={!!diag} onClose={() => setDiag(null)} title="Corriger le motif" footer={<>
        <button className="btn" onClick={() => setDiag(null)}>Annuler</button>
        <button className="btn btn-primary" onClick={async () => { await act(`/queue/${diag.id}/diagnosis`, { text: diagText }, "Motif corrigé"); setDiag(null); }}>Enregistrer</button>
      </>}>
        {diag && <div className="form">
          <p className="muted">Motif déclaré à l'accueil : <b>{diag.complaint ?? "-"}</b></p>
          <label>Motif constaté / diagnostic<textarea rows={3} maxLength={500} value={diagText} onChange={(e) => setDiagText(e.target.value)} placeholder="Ex. carie profonde 46, pulpite irréversible" /></label>
        </div>}
      </Modal>
    </>
  );
}

/** Enregistrement d'une arrivée : patient déjà suivi (aucune ressaisie) ou nouveau patient (dossier minimal). */
function ArrivalModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { ref } = useSession();
  const toasts = useToasts();
  const [isNew, setIsNew] = useState(false);
  const [qtext, setQ] = useState(""); const [results, setResults] = useState<any[]>([]);
  const [picked, setPicked] = useState<any>(null); const [summary, setSummary] = useState<any>(null);
  const [np, setNp] = useState<any>(emptyPatient());
  const [complaint, setComplaint] = useState(""); const [doctorId, setDoctorId] = useState(""); const [urgent, setUrgent] = useState(false);
  const [err, setErr] = useState<string | null>(null); const [busyS, setBusy] = useState(false);
  useEffect(() => { if (open) { setIsNew(false); setQ(""); setResults([]); setPicked(null); setSummary(null); setNp(emptyPatient()); setComplaint(""); setDoctorId(""); setUrgent(false); setErr(null); } }, [open]);
  useEffect(() => {
    if (qtext.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => api.get(`/patients?q=${encodeURIComponent(qtext)}`).then((l) => setResults(l.slice(0, 8))).catch(() => undefined), 200);
    return () => clearTimeout(t);
  }, [qtext]);
  const pick = async (p: any) => {
    setPicked(p); setResults([]); setQ("");
    if (!doctorId && p.primaryDoctorId && ref?.doctors.some((d) => d.id === p.primaryDoctorId)) setDoctorId(String(p.primaryDoctorId));
    try { setSummary((await api.get(`/patients/${p.id}/dossier`)).summary); } catch { setSummary(null); }
  };
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      let r;
      if (isNew) r = await api.post("/queue/new-patient", { patient: np, complaint, urgent, doctorId: Number(doctorId) || null });
      else if (!picked) throw new Error("Choisissez un patient ou créez un nouveau dossier.");
      else r = await api.post("/queue/arrival", { patientId: picked.id, complaint, urgent, doctorId: Number(doctorId) || null });
      r.warnings?.forEach((w: string) => toasts.show("info", w));
      toasts.success("Patient ajouté à la file d'attente"); onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const set = (k: string, v: any) => setNp((x: any) => ({ ...x, [k]: v }));
  return (
    <Modal open={open} onClose={onClose} title="Enregistrer une arrivée" wide footer={<>
      <button className="btn" onClick={onClose}>Annuler</button>
      <button className="btn btn-primary" disabled={busyS} onClick={submit}><Icon n="coche" /> Ajouter à la file</button>
    </>}>
      <div className="form">
        <div className="seg">
          <button className={isNew ? "" : "on"} onClick={() => setIsNew(false)}>Patient déjà suivi</button>
          <button className={isNew ? "on" : ""} onClick={() => setIsNew(true)}>Nouveau patient</button>
        </div>
        {!isNew ? (!picked ? <>
          <div className="field">Rechercher le patient (nom, téléphone, n° de dossier)
            <div className="patient-search">
              <input value={qtext} onChange={(e) => setQ(e.target.value)} maxLength={60} placeholder="Ex. Martin, 06 12…, P-000042" autoFocus />
              {results.length > 0 && <ul className="dropdown">{results.map((p) => (
                <li key={p.id} onClick={() => pick(p)}><b>{patientFullName(p)}</b> <small>{ageOf(p.birthDate)} ans · {p.phone} · {p.fileNo}</small>{p.allergies && <span className="chip chip-red">allergie</span>}</li>
              ))}</ul>}
            </div>
          </div>
          <p className="hint">Le dossier existe déjà : aucune information n'est à ressaisir.</p>
        </> : (
          <div className="picked-card">
            <span className="avatar lg f">{picked.firstName[0]}{picked.lastName[0]}</span>
            <div><b>{patientFullName(picked)}</b><small>{ageOf(picked.birthDate)} ans · {picked.fileNo} · {picked.phone}</small>{picked.allergies && <span className="chip chip-red"><Icon n="alerte" /> {picked.allergies}</span>}</div>
            {summary && <dl className="mini-stats">
              <div><dt>Passages</dt><dd>{summary.visits}</dd></div>
              <div><dt>Dernier passage</dt><dd>{summary.lastVisit ? dDate(summary.lastVisit) : "-"}</dd></div>
              <div><dt>Soins en cours</dt><dd>{summary.openPlans}</dd></div>
              <div><dt>Reste dû</dt><dd className={summary.remaining > 0 ? "money-due" : ""}>{money(summary.remaining)}</dd></div>
            </dl>}
            <button className="link" onClick={() => { setPicked(null); setSummary(null); }}>changer</button>
          </div>
        )) : <>
          <div className="grid3">
            <label>Nom *<input value={np.lastName} maxLength={60} onChange={(e) => set("lastName", e.target.value)} /></label>
            <label>Prénom *<input value={np.firstName} maxLength={60} onChange={(e) => set("firstName", e.target.value)} /></label>
            <label>Date de naissance *<input type="date" value={np.birthDate} onChange={(e) => set("birthDate", e.target.value)} /></label>
            <label>Sexe<select value={np.sex} onChange={(e) => set("sex", e.target.value)}><option value="F">Femme</option><option value="M">Homme</option><option value="X">Autre</option></select></label>
            <label>Téléphone *<input value={np.phone} maxLength={20} inputMode="tel" onChange={(e) => set("phone", e.target.value)} /></label>
            <label>Mutuelle<input value={np.mutuelle} maxLength={60} onChange={(e) => set("mutuelle", e.target.value)} /></label>
          </div>
          <label>Allergies connues<input value={np.allergies} maxLength={300} placeholder="Pénicilline, latex… (laisser vide si aucune)" onChange={(e) => set("allergies", e.target.value)} /></label>
          <p className="hint">Le dossier complet (adresse, n° de sécurité sociale…) pourra être complété plus tard.</p>
        </>}
        <label>Motif déclaré par le patient (provisoire, le praticien le corrigera)
          <textarea rows={2} maxLength={300} value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Ex. douleur en bas à droite depuis 3 jours, dent cassée, contrôle…" />
        </label>
        <div className="grid2">
          <label>Praticien
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Premier praticien disponible</option>
              {ref?.doctors.map((d) => <option key={d.id} value={d.id}>Dr {d.fullName}</option>)}
            </select>
          </label>
          <label className="check big"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} /> Urgence (passe en tête de file)</label>
        </div>
        <Alerts errors={err} />
      </div>
    </Modal>
  );
}
