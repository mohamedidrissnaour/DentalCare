import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useSession, useLive } from "../lib/session";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { useToasts } from "../lib/toasts";
import { Icon } from "../components/Icon";
import { Modal, Alerts, PageLoader, Empty } from "../components/ui";
import { PatientForm } from "../components/PatientForm";
import { money, dDate, dTime, dWeekday, dDayTime } from "../lib/format";
import { P, isDoctor, ageOf, patientFullName, apptStatusCss, apptStatusLabel, visitStatusCss, visitStatusLabel, planStatusCss, planStatusLabel,
  invoiceStatusLabel, rxStatusLabel, fmtDateTime, fmtDay } from "../../../shared/domain";

const TABS: [string, string][] = [["consultations", "Consultations"], ["paiements", "Paiements"], ["plans", "Traitements en plusieurs séances"], ["rdv", "Rendez-vous"], ["ordo", "Ordonnances"], ["infos", "Informations"]];

/** Une ligne par jour de venue : heure exacte d'arrivée, motif, praticien, soins réalisés ce jour-là. */
function buildDays(d: any) {
  const day = (s: string) => s.slice(0, 10);
  const days = [...new Set<string>([
    ...d.visits.map((v: any) => v.visitDay), ...d.treatments.map((t: any) => day(t.performedAt)),
    ...d.appointments.filter((a: any) => a.status === "Termine").map((a: any) => day(a.startAt)),
  ])].sort().reverse();
  return days.map((dd) => {
    const v = d.visits.filter((x: any) => x.visitDay === dd).sort((a: any, b: any) => a.arrivedAt.localeCompare(b.arrivedAt))[0];
    const a = d.appointments.filter((x: any) => day(x.startAt) === dd && x.status !== "Annule" && x.status !== "Absent").sort((x: any, y: any) => x.startAt.localeCompare(y.startAt))[0];
    const care = d.treatments.filter((t: any) => day(t.performedAt) === dd).sort((x: any, y: any) => x.performedAt.localeCompare(y.performedAt));
    return {
      day: dd, time: v?.arrivedAt ?? a?.arrivedAt ?? a?.startAt ?? care[0]?.performedAt ?? null,
      kind: v || a?.arrivedAt ? "arrivée" : a ? "rendez-vous" : "soin",
      reason: v?.diagnosis ?? v?.complaint ?? a?.actLabel ?? a?.reason ?? care[0]?.label ?? null,
      declared: v?.diagnosis && v?.complaint ? v.complaint : null,
      doctor: v?.doctorName ?? a?.doctorName ?? care[0]?.doctorName ?? null,
      status: v ? visitStatusLabel(v.status) : a ? apptStatusLabel(a.status) : null,
      css: v ? visitStatusCss(v.status) : a ? apptStatusCss(a.status) : "",
      care,
    };
  });
}

export function PatientDetail() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { me, can, ref } = useSession();
  const toasts = useToasts();
  const d = useApi<any>(`/patients/${id}/dossier`, [id]);
  const [tab, setTab] = useState(TABS.some((t) => t[0] === params.get("onglet")) ? params.get("onglet")! : "consultations");
  const [form, setForm] = useState(false);
  const [treat, setTreat] = useState<any>(null); const [treatErr, setTreatErr] = useState<string | null>(null);
  const [plan, setPlan] = useState<any>(null); const [planErr, setPlanErr] = useState<string | null>(null);
  const [anon, setAnon] = useState(false);
  useLive(["visits", "appointments", "prescriptions"], () => d.reload());
  const days = useMemo(() => (d.data ? buildDays(d.data) : []), [d.data]);
  const selfDoctor = !!me && isDoctor(me.role);
  const newTreatment = (tooth?: number | null) => ({ patientId: Number(id), tooth: tooth ?? "", performedAt: fmtDay(new Date()), label: "", price: 0, actTypeId: "", planId: "", doctorId: 0, notes: "" });
  useEffect(() => { if (params.get("soin") === "1" && can(P.CareEdit)) setTreat(newTreatment()); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (d.error) return <Empty icon="patients" title="Dossier introuvable"><Link className="btn btn-primary" to="/patients">Retour</Link></Empty>;
  if (!d.data || !me) return <PageLoader text="Ouverture du dossier…" />;
  const { patient: p, summary: sum, treatments, plans, appointments, payments, invoices, prescriptions } = d.data;
  document.title = `${patientFullName(p)} - DentaCare`;
  const doctors = ref?.doctors ?? [], acts = (ref?.actTypes ?? []).filter((a: any) => a.active);
  const unbilled = treatments.filter((t: any) => !t.invoiceId);

  const onTreatPlan = (v: string) => {
    const pl = plans.find((x: any) => x.id === Number(v));
    setTreat((t: any) => pl ? { ...t, planId: v, tooth: pl.tooth ?? "", actTypeId: pl.actTypeId ?? "", label: `${pl.label} - séance ${pl.sessionsDone + 1}/${pl.sessionsPlanned}`,
      price: pl.sessionsPlanned > 0 && pl.estimatedPrice > 0 ? Math.round((pl.estimatedPrice / pl.sessionsPlanned) * 100) / 100 : t.price } : { ...t, planId: v });
  };
  const onTreatAct = (v: string) => { const a = acts.find((x: any) => x.id === Number(v)); setTreat((t: any) => ({ ...t, actTypeId: v, ...(a ? { label: a.label, price: a.price } : {}) })); };
  const saveTreatment = async () => {
    try {
      const r = await api.post("/treatments", { ...treat, tooth: Number(treat.tooth) || null, planId: Number(treat.planId) || null, actTypeId: Number(treat.actTypeId) || null, price: Number(treat.price) });
      toasts.success("Soin enregistré", treat.label); r.warnings?.forEach((w: string) => toasts.show("info", w));
      setTreat(null); d.reload();
    } catch (e: any) { setTreatErr(e.message); }
  };
  const savePlan = async () => {
    try {
      await api.post("/plans", { ...plan, tooth: Number(plan.tooth) || null, actTypeId: Number(plan.actTypeId) || null, sessionsPlanned: Number(plan.sessionsPlanned), estimatedPrice: Number(plan.estimatedPrice) });
      toasts.success("Plan de traitement créé", plan.label); setPlan(null); d.reload();
    } catch (e: any) { setPlanErr(e.message); }
  };
  const run = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toasts.success(ok); d.reload(); } catch (e: any) { toasts.error(e.message); } };
  const refDoc = doctors.find((x: any) => x.id === p.primaryDoctorId);

  return (
    <>
      <section className="pt-head">
        <div className="pt-id">
          <span className="avatar xl f">{p.firstName[0]}{p.lastName[0]}</span>
          <div>
            <h1>{patientFullName(p)} {!!p.archived && <span className="chip">archivé</span>}</h1>
            <p className="muted">{ageOf(p.birthDate)} ans · né{p.sex === "F" ? "e" : ""} le {dDate(p.birthDate)} · dossier {p.fileNo}</p>
          </div>
          <div className="pt-actions">
            <Link className="btn" to={`/agenda?nouveau=1&patient=${p.id}`}><Icon n="calendrier" /> Rendez-vous</Link>
            {can(P.CareEdit) && <button className="btn" onClick={() => { setTreat(newTreatment()); setTreatErr(null); }}><Icon n="consultation" /> Soin</button>}
            {can(P.RxWrite) && <Link className="btn btn-primary" to={`/ordonnances/nouvelle?patient=${p.id}`}><Icon n="ordonnance" /> Ordonnance</Link>}
            {can(P.PatientEdit) && <button className="btn" onClick={() => setForm(true)}><Icon n="crayon" /> Modifier</button>}
          </div>
        </div>
        <dl className="pt-info">
          <div><dt>Téléphone</dt><dd><a href={`tel:${p.phone}`}>{p.phone}</a></dd></div>
          <div><dt>E-mail</dt><dd>{p.email ?? "-"}</dd></div>
          <div><dt>Adresse</dt><dd>{!p.address && !p.city ? "-" : `${p.address ?? ""} ${p.postalCode ?? ""} ${p.city ?? ""}`}</dd></div>
          <div><dt>Mutuelle</dt><dd>{p.mutuelle ?? "-"}</dd></div>
          <div><dt>Praticien référent</dt><dd>{refDoc ? "Dr " + refDoc.fullName : "-"}</dd></div>
          <div><dt>Patient depuis</dt><dd>{dDate(sum.firstVisit ?? p.createdAt)}</dd></div>
        </dl>
        {p.allergies && <div className="pt-allergy"><Icon n="alerte" /> Allergies : <b>{p.allergies}</b></div>}
        <div className="pt-kpis">
          <div><small>Soins réalisés</small><b>{money(sum.totalCare)}</b></div>
          <div className="ok"><small>Payé</small><b>{money(sum.paid)}</b></div>
          <div className={sum.remaining > 0 ? "due" : ""}><small>Reste à payer</small><b>{money(sum.remaining)}</b></div>
          <div><small>Passages</small><b>{sum.visits}</b></div>
          <div><small>Dernier passage</small><b>{sum.lastVisit ? dDate(sum.lastVisit) : "-"}</b></div>
          <div><small>Prochain rendez-vous</small><b>{sum.nextAppointment ? dDayTime(sum.nextAppointment) : "-"}</b></div>
        </div>
      </section>

      <nav className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>

      <div className="tab-body" key={tab}>
        {tab === "consultations" && (
          <div className="card flush">
            <header className="card-head"><h3>Consultations par jour</h3><span className="muted">{days.length} jour(s) de venue</span></header>
            <div className="scroll-x"><table className="table day-table">
              <thead><tr><th style={{ width: 110 }}>Date</th><th style={{ width: 90 }}>Heure</th><th>Motif</th><th>Praticien</th><th>Soins réalisés</th><th className="num">Montant</th><th>Statut</th></tr></thead>
              <tbody>
                {days.map((x) => (
                  <tr key={x.day}>
                    <td className="num-l strong">{dDate(x.day)}<small className="block muted">{dWeekday(x.day)}</small></td>
                    <td className="num-l">{x.time ? dTime(x.time) : "-"}<small className="block muted">{x.kind}</small></td>
                    <td>{x.reason ?? "-"}{x.declared && <small className="block muted">déclaré : {x.declared}</small>}</td>
                    <td>{x.doctor ? "Dr " + x.doctor : "-"}</td>
                    <td>{x.care.length ? x.care.map((t: any) => (
                      <div className="care-line" key={t.id}>{t.label}{t.tooth ? ` · dent ${t.tooth}` : ""}{t.sessionNo ? ` · séance ${t.sessionNo}/${t.planSessions}` : ""}
                        {can(P.CareDelete) && !t.invoiceId && <button className="link danger" title="Supprimer ce soin (non facturé)" onClick={() => run(() => api.del(`/treatments/${t.id}`), "Soin supprimé")}> ✕</button>}</div>
                    )) : <span className="muted">-</span>}</td>
                    <td className="num">{x.care.length ? money(x.care.reduce((s: number, t: any) => s + t.price, 0)) : "-"}</td>
                    <td>{x.status && <span className={`status ${x.css}`}>{x.status}</span>}</td>
                  </tr>
                ))}
                {!days.length && <tr><td colSpan={7} className="muted center">Aucune consultation enregistrée</td></tr>}
              </tbody>
            </table></div>
          </div>
        )}

        {tab === "paiements" && (
          <div className="grid-2col">
            <div className="card flush">
              <header className="card-head"><h3>Règlements par date</h3><b className="num">{money(payments.reduce((s: number, x: any) => s + x.amount, 0))}</b></header>
              <table className="table">
                <thead><tr><th>Date</th><th>Heure</th><th>Mode</th><th>Facture</th><th>Reçu par</th><th className="num">Montant</th></tr></thead>
                <tbody>
                  {payments.map((x: any) => <tr key={x.id}><td className="num-l">{dDate(x.paidAt)}</td><td className="num-l">{dTime(x.paidAt)}</td><td>{x.method}</td>
                    <td><Link className="link" to={`/facturation?facture=${x.invoiceId}`}>{x.invoiceNumber}</Link></td><td className="muted">{x.receivedByName}</td><td className="num strong">{money(x.amount)}</td></tr>)}
                  {!payments.length && <tr><td colSpan={6} className="muted center">Aucun règlement</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="card flush">
              <header className="card-head"><h3>Reste à payer</h3><b className={"num" + (sum.remaining > 0 ? " money-due" : "")}>{money(sum.remaining)}</b></header>
              <table className="table">
                <thead><tr><th>Date</th><th>Facture / soin</th><th className="num">Total</th><th className="num">Payé</th><th className="num">Reste</th></tr></thead>
                <tbody>
                  {invoices.filter((i: any) => i.status !== "Annulee").map((i: any) => {
                    const rem = Math.max(0, i.total - i.paid);
                    return <tr key={"i" + i.id}><td className="num-l">{dDate(i.issuedAt)}</td><td><Link className="link" to={`/facturation?facture=${i.id}`}>{i.number}</Link> <span className={`status inv-${i.status.toLowerCase()}`}>{invoiceStatusLabel(i.status)}</span></td>
                      <td className="num">{money(i.total)}</td><td className="num">{money(i.paid)}</td><td className={"num" + (rem > 0 ? " money-due" : "")}>{money(rem)}</td></tr>;
                  })}
                  {unbilled.map((t: any) => <tr key={"t" + t.id}><td className="num-l">{dDate(t.performedAt)}</td><td>{t.label} <span className="chip">non facturé</span></td>
                    <td className="num">{money(t.price)}</td><td className="num">{money(0)}</td><td className="num money-due">{money(t.price)}</td></tr>)}
                  {!invoices.length && !unbilled.length && <tr><td colSpan={5} className="muted center">Rien à payer</td></tr>}
                </tbody>
              </table>
              {unbilled.length > 0 && can(P.BillingCollect) && <div className="pad"><Link className="btn btn-primary" to={`/facturation?patient=${p.id}`}><Icon n="euro" /> Facturer et encaisser</Link></div>}
            </div>
          </div>
        )}

        {tab === "plans" && (
          <div className="card flush">
            <header className="card-head"><h3>Traitements en plusieurs séances</h3>
              {can(P.CareEdit) && <button className="btn btn-primary btn-sm" onClick={() => { setPlan({ patientId: p.id, sessionsPlanned: 2, estimatedPrice: 0, label: "", tooth: "", actTypeId: "", doctorId: 0, notes: "" }); setPlanErr(null); }}><Icon n="plus" /> Nouveau traitement</button>}</header>
            <div className="scroll-x"><table className="table">
              <thead><tr><th>Traitement</th><th>Dent</th><th>Praticien</th><th>Début</th><th>Dernière séance</th><th style={{ width: 180 }}>Avancement</th><th className="num">Réalisé</th><th className="num">Estimé</th><th>Statut</th><th></th></tr></thead>
              <tbody>
                {plans.map((pl: any) => (
                  <tr key={pl.id}>
                    <td><b>{pl.label}</b>{pl.notes && <small className="block muted">{pl.notes}</small>}</td>
                    <td>{pl.tooth ?? "-"}</td><td>Dr {pl.doctorName}</td><td className="num-l">{dDate(pl.createdAt)}</td><td className="num-l">{pl.lastSession ? dDate(pl.lastSession) : "-"}</td>
                    <td><span className="plan-progress"><span className="num-l">{pl.sessionsDone}/{pl.sessionsPlanned} séances</span><span className="meter"><i style={{ width: `${Math.min(100, Math.floor((pl.sessionsDone * 100) / pl.sessionsPlanned))}%` }}></i></span></span></td>
                    <td className="num">{money(pl.billed)}</td><td className="num muted">{money(pl.estimatedPrice)}</td>
                    <td><span className={`status ${planStatusCss(pl.status)}`}>{planStatusLabel(pl.status)}</span></td>
                    <td>{can(P.CareEdit) && pl.status === "EnCours" && <div className="row-actions">
                      <button className="btn btn-sm" onClick={() => { setTreat(newTreatment(pl.tooth)); setTreatErr(null); setTimeout(() => onTreatPlan(String(pl.id))); }}><Icon n="plus" /> Séance</button>
                      <button className="btn btn-sm btn-ghost" onClick={() => run(() => api.post(`/plans/${pl.id}/status`, { status: "Termine" }), "Plan : Terminé")}>Terminer</button>
                    </div>}</td>
                  </tr>
                ))}
                {!plans.length && <tr><td colSpan={10} className="muted center">Aucun traitement en plusieurs séances. Exemple : dévitalisation de la 36 en 3 séances.</td></tr>}
              </tbody>
            </table></div>
          </div>
        )}

        {tab === "rdv" && (
          <div className="card flush">
            <header className="card-head"><h3>Rendez-vous</h3></header>
            <table className="table">
              <thead><tr><th>Date</th><th>Heure</th><th>Arrivé à</th><th>Acte</th><th>Praticien</th><th>Remarque</th><th>Statut</th></tr></thead>
              <tbody>
                {appointments.map((a: any) => <tr key={a.id}><td className="num-l">{dDate(a.startAt)}</td><td className="num-l">{dTime(a.startAt)}</td><td className="num-l">{a.arrivedAt ? dTime(a.arrivedAt) : "-"}</td>
                  <td><span className="act-dot" style={{ background: a.actColor ?? a.doctorColor }}></span>{a.actLabel ?? a.reason}</td><td>Dr {a.doctorName}</td><td className="muted">{a.cancelReason}</td>
                  <td><span className={`status ${apptStatusCss(a.status)}`}>{apptStatusLabel(a.status)}</span></td></tr>)}
                {!appointments.length && <tr><td colSpan={7} className="muted center">Aucun rendez-vous</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {tab === "ordo" && (
          <div className="card flush">
            <header className="card-head"><h3>Ordonnances</h3></header>
            <ul className="mini-list">
              {prescriptions.map((r: any) => <li key={r.id}><Link to={`/ordonnances/${r.id}`}><b>{r.number}</b> · {dDate(r.createdAt)} · Dr {r.doctorName} · {r.itemCount} ligne(s)</Link>
                <span className={`status rx-${r.status.toLowerCase()}`}>{rxStatusLabel(r.status)}</span></li>)}
              {!prescriptions.length && <li className="muted">Aucune ordonnance</li>}
            </ul>
          </div>
        )}

        {tab === "infos" && (
          <>
            <div className="grid-2col">
              <div className="card"><h3>Coordonnées</h3>
                <dl className="dl">
                  <dt>Adresse</dt><dd>{p.address} {p.postalCode} {p.city}</dd>
                  <dt>N° sécurité sociale</dt><dd>{p.ssn && p.ssn.length > 4 ? "•••••••••" + p.ssn.slice(-4) : "-"}</dd>
                  <dt>Mutuelle</dt><dd>{p.mutuelle ?? "-"}</dd>
                  <dt>Dossier créé le</dt><dd>{dDate(p.createdAt)}</dd>
                </dl>
              </div>
              <div className="card"><h3>Santé</h3>
                <dl className="dl">
                  <dt>Allergies</dt><dd className={p.allergies ? "danger" : ""}>{p.allergies ?? "Aucune déclarée"}</dd>
                  {can(P.PatientMedical) && <>
                    <dt>Antécédents</dt><dd>{p.medicalHistory ?? "-"}</dd>
                    <dt>Traitements en cours</dt><dd>{p.currentTreatments ?? "-"}</dd>
                    <dt>Notes cliniques</dt><dd>{p.notes ?? "-"}</dd>
                  </>}
                </dl>
              </div>
            </div>
            <div className="danger-zone">
              {can(P.PatientArchive) && <button className="btn btn-ghost" onClick={() => run(() => api.post(`/patients/${p.id}/archive`, { archived: !p.archived }), p.archived ? "Dossier désarchivé" : "Dossier archivé")}>{p.archived ? "Désarchiver" : "Archiver le dossier"}</button>}
              {can(P.PatientAnonymize) && p.lastName !== "ANONYME" && <button className="btn btn-danger-ghost" onClick={() => setAnon(true)}><Icon n="corbeille" /> Anonymiser (droit à l'effacement RGPD)</button>}
            </div>
          </>
        )}
      </div>

      <PatientForm open={form} onClose={() => setForm(false)} model={{ ...p, primaryDoctorId: p.primaryDoctorId ?? "" }} onSaved={() => d.reload()} />

      <Modal open={!!treat} onClose={() => setTreat(null)} title="Enregistrer un soin" footer={<><button className="btn" onClick={() => setTreat(null)}>Annuler</button><button className="btn btn-primary" onClick={saveTreatment}>Enregistrer</button></>}>
        {treat && <div className="form">
          <label>Rattacher à un traitement en plusieurs séances
            <select value={treat.planId} onChange={(e) => onTreatPlan(e.target.value)}>
              <option value="">- soin ponctuel -</option>
              {plans.filter((x: any) => x.status === "EnCours").map((pl: any) => <option key={pl.id} value={pl.id}>{pl.label}{pl.tooth ? ` (dent ${pl.tooth})` : ""} - séance {pl.sessionsDone + 1}/{pl.sessionsPlanned}</option>)}
            </select>
          </label>
          {!selfDoctor && <label>Praticien ayant réalisé le soin *
            <select value={treat.doctorId} onChange={(e) => setTreat({ ...treat, doctorId: Number(e.target.value) })}><option value={0}>- choisir -</option>{doctors.map((x: any) => <option key={x.id} value={x.id}>Dr {x.fullName}</option>)}</select></label>}
          <label>Acte
            <select value={treat.actTypeId} onChange={(e) => onTreatAct(e.target.value)}>
              <option value="">- libre -</option>
              {acts.map((a: any) => <option key={a.id} value={a.id}>{a.code} - {a.label} ({money(a.price)})</option>)}
            </select>
          </label>
          <div className="grid2">
            <label>Libellé<input value={treat.label} maxLength={120} onChange={(e) => setTreat({ ...treat, label: e.target.value })} /></label>
            <label>Dent (FDI)<input type="number" min={11} max={48} value={treat.tooth} onChange={(e) => setTreat({ ...treat, tooth: e.target.value })} /></label>
            <label>Montant (€)<input type="number" min={0} step={0.01} value={treat.price} onChange={(e) => setTreat({ ...treat, price: e.target.value })} /></label>
            <label>Date<input type="date" value={treat.performedAt} onChange={(e) => setTreat({ ...treat, performedAt: e.target.value })} /></label>
          </div>
          <label>Notes<textarea rows={2} maxLength={500} value={treat.notes} onChange={(e) => setTreat({ ...treat, notes: e.target.value })} /></label>
          <Alerts errors={treatErr} />
        </div>}
      </Modal>

      <Modal open={!!plan} onClose={() => setPlan(null)} title="Nouveau plan de traitement" footer={<><button className="btn" onClick={() => setPlan(null)}>Annuler</button><button className="btn btn-primary" onClick={savePlan}>Créer le plan</button></>}>
        {plan && <div className="form">
          {!selfDoctor && <label>Praticien responsable *
            <select value={plan.doctorId} onChange={(e) => setPlan({ ...plan, doctorId: Number(e.target.value) })}><option value={0}>- choisir -</option>{doctors.map((x: any) => <option key={x.id} value={x.id}>Dr {x.fullName}</option>)}</select></label>}
          <label>Acte
            <select value={plan.actTypeId} onChange={(e) => { const a = acts.find((x: any) => x.id === Number(e.target.value)); setPlan({ ...plan, actTypeId: e.target.value, ...(a ? { label: a.label, estimatedPrice: a.price } : {}) }); }}>
              <option value="">- libre -</option>{acts.map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <div className="grid2">
            <label>Libellé<input value={plan.label} maxLength={120} placeholder="Ex. Dévitalisation" onChange={(e) => setPlan({ ...plan, label: e.target.value })} /></label>
            <label>Dent (FDI)<input type="number" min={11} max={48} value={plan.tooth} onChange={(e) => setPlan({ ...plan, tooth: e.target.value })} /></label>
            <label>Nombre de séances prévues<input type="number" min={1} max={30} value={plan.sessionsPlanned} onChange={(e) => setPlan({ ...plan, sessionsPlanned: e.target.value })} /></label>
            <label>Montant total estimé (€)<input type="number" min={0} step={0.01} value={plan.estimatedPrice} onChange={(e) => setPlan({ ...plan, estimatedPrice: e.target.value })} /></label>
          </div>
          <label>Notes<textarea rows={2} maxLength={500} value={plan.notes} onChange={(e) => setPlan({ ...plan, notes: e.target.value })} /></label>
          <Alerts errors={planErr} />
        </div>}
      </Modal>

      <Modal open={anon} onClose={() => setAnon(false)} title="Anonymiser ce dossier ?" footer={<>
        <button className="btn" onClick={() => setAnon(false)}>Annuler</button>
        <button className="btn btn-danger" onClick={() => { setAnon(false); run(() => api.post(`/patients/${p.id}/anonymize`), "Dossier anonymisé"); }}>Anonymiser définitivement</button>
      </>}>
        <p>Cette opération est <b>irréversible</b> : identité, coordonnées et données médicales seront effacées. Les factures restent conservées (obligation comptable) sous un nom anonyme.</p>
      </Modal>
    </>
  );
}
