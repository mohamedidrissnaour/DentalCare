import { Link } from "react-router-dom";
import { useSession, useLive } from "../lib/session";
import { useApi } from "../lib/hooks";
import { qs } from "../lib/api";
import { Icon } from "../components/Icon";
import { PageLoader, PageHead } from "../components/ui";
import { Donut, BarChart } from "../components/charts";
import { money, dTime } from "../lib/format";
import { P, Roles, apptStatusCss, apptStatusLabel, rxStatusLabel, userTitle, fmtDay, fmtDateTime } from "../../../shared/domain";

const greeting = () => { const h = new Date().getHours(); return h >= 18 ? "Bonsoir" : h >= 12 ? "Bon après-midi" : "Bonjour"; };

export function Home() {
  const { me, can, queue } = useSession();
  const today = fmtDay(new Date()), tomorrow = fmtDay(new Date(Date.now() + 86400000));
  const m0 = new Date(); const month = fmtDay(new Date(m0.getFullYear(), m0.getMonth(), 1)), monthEnd = fmtDay(new Date(m0.getFullYear(), m0.getMonth() + 1, 1));
  const s = useApi("/dashboard");
  const appts = useApi<any[]>(`/appointments${qs({ from: today, to: tomorrow, doctorId: me?.role === Roles.Docteur ? me.id : null })}`);
  const rx = useApi<any[]>("/rx");
  const pil = useApi<any>(can(P.PilotageAll) ? `/pilotage${qs({ from: month, to: monthEnd })}` : null);
  useLive(["appointments", "visits", "prescriptions"], () => { s.reload(); appts.reload(); rx.reload(); });
  if (!s.data || !me) return <PageLoader text="Préparation du tableau de bord…" />;
  const d = s.data, rev = can(P.StatsRevenue), now = fmtDateTime(new Date());
  const maxAct = Math.max(1, ...d.byAct.map((x: any) => x.value));
  return (
    <>
      <PageHead title={`${greeting()} ${userTitle(me)}`} sub={`${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${d.todayTotal === 0 ? "aucun rendez-vous aujourd'hui" : `${d.todayTotal} rendez-vous aujourd'hui`}`}>
        <Link className="btn" to="/agenda?nouveau=1"><Icon n="calendrier" /> Rendez-vous</Link>
        <Link className="btn" to="/patients?nouveau=1"><Icon n="utilisateur" /> Patient</Link>
        {can(P.RxWrite) && <Link className="btn btn-primary" to="/ordonnances/nouvelle"><Icon n="plus" /> Ordonnance</Link>}
      </PageHead>
      <section className="kpis">
        <div className="kpi kpi-ico"><span className="kpi-icon blue"><Icon n="calendrier" size={20} /></span><div><small>Rendez-vous du jour</small><b>{d.todayTotal}</b><em>{d.todayDone} terminé(s)</em></div></div>
        <Link className="kpi kpi-ico" to="/file-attente"><span className="kpi-icon green"><Icon n="salle-attente" size={20} /></span><div><small>File d'attente</small><b>{queue.waiting}</b><em>{queue.inCare} en consultation · attente moy. {Math.round(queue.avgWait)} min</em></div></Link>
        <div className="kpi kpi-ico"><span className="kpi-icon blue"><Icon n="patients" size={20} /></span><div><small>Patients actifs</small><b>{d.patientsTotal}</b><em>+{d.newPatientsMonth} ce mois</em></div></div>
        {!rev
          ? <Link className="kpi kpi-ico" to="/ordonnances"><span className="kpi-icon green"><Icon n="imprimante" size={20} /></span><div><small>Ordonnances à imprimer</small><b>{d.rxToPrint}</b><em>Ouvrir la file</em></div></Link>
          : <div className="kpi kpi-ico"><span className="kpi-icon green"><Icon n="euro" size={20} /></span><div><small>Actes du mois</small><b>{money(d.revenueMonth)}</b><em>{money(d.collectedMonth)} encaissés</em></div></div>}
        {rev && <Link className="kpi kpi-ico" to="/facturation"><span className="kpi-icon gray"><Icon n="facture" size={20} /></span><div><small>Reste à encaisser</small><b>{money(d.outstanding)}</b><em>Voir les factures</em></div></Link>}
      </section>

      {can(P.PilotageAll) && !!pil.data?.doctors?.length && (
        <div className="card flush">
          <header className="card-head"><h3>Activité des praticiens ce mois</h3><Link className="link" to="/pilotage">Pilotage détaillé</Link></header>
          <table className="table">
            <thead><tr><th>Praticien</th><th className="num">Rendez-vous</th><th className="num">Patients soignés</th><th className="num">Actes</th><th className="num">Encaissé</th><th className="num">Soins en cours</th><th className="num">Absences</th></tr></thead>
            <tbody>{pil.data.doctors.map((x: any) => (
              <tr key={x.doctorId}><td><span className="doc-tag" style={{ ["--c" as any]: x.color }}>Dr {x.name}</span></td><td className="num">{x.appointments}</td><td className="num">{x.patientsSeen}</td>
                <td className="num strong">{money(x.care)}</td><td className="num">{money(x.collected)}</td><td className="num">{x.openPlans}</td><td className="num">{x.noShowRate} %</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <section className="grid-dash">
        <div className="card span2 flush">
          <header className="card-head"><h3>Programme du jour</h3><Link to="/agenda" className="link">Ouvrir l'agenda</Link></header>
          {!appts.data?.length ? <div className="empty-mini">Aucun rendez-vous aujourd'hui.</div> : (
            <table className="table">
              <thead><tr><th style={{ width: 70 }}>Heure</th><th>Patient</th><th>Acte</th><th>Praticien</th><th>Statut</th><th style={{ width: 28 }}></th></tr></thead>
              <tbody>{appts.data.map((a) => (
                <tr key={a.id} className={a.startAt <= now && a.endAt >= now ? "row-now" : ""}>
                  <td className="num-l">{dTime(a.startAt)}</td>
                  <td><Link to={`/patients/${a.patientId}`} className="strong">{a.patientName}</Link></td>
                  <td><span className="act-dot" style={{ background: a.actColor ?? a.doctorColor }}></span>{a.actLabel ?? a.reason}</td>
                  <td className="muted">Dr {a.doctorName}</td>
                  <td><span className={`status ${apptStatusCss(a.status)}`}>{apptStatusLabel(a.status)}</span></td>
                  <td>{(!!a.patientAllergy || !!a.isUrgent) && <span className="flag-danger" title={a.isUrgent ? "Urgence" : "Allergie déclarée"}><Icon n="alerte" /></span>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="card"><header className="card-head"><h3>Rendez-vous du mois</h3></header><Donut data={d.byStatus} centerLabel="RDV" /></div>
        <div className="card"><header className="card-head"><h3>Rendez-vous de la semaine</h3></header><BarChart data={d.week} /></div>
        {rev && <div className="card"><header className="card-head"><h3>Encaissements - 6 mois</h3><b className="num">{money(d.collectedMonth)}</b></header><BarChart data={d.revenue6M} money /></div>}
        {rev && (
          <div className="card">
            <header className="card-head"><h3>Chiffre par acte (3 mois)</h3></header>
            <ul className="meter-list">
              {d.byAct.map((x: any) => <li key={x.label}><span>{x.label}</span><b className="num">{Math.round(x.value).toLocaleString("fr-FR")} €</b><div className="meter"><i style={{ width: `${Math.round((x.value / maxAct) * 100)}%` }}></i></div></li>)}
              {!d.byAct.length && <li className="muted">Aucun soin enregistré</li>}
            </ul>
          </div>
        )}
        <div className={"card flush" + (rev ? " span2" : "")}>
          <header className="card-head"><h3>Ordonnances récentes</h3><Link to="/ordonnances" className="link">Voir tout</Link></header>
          <ul className="mini-list">
            {(rx.data ?? []).slice(0, 6).map((r) => <li key={r.id}><Link to={`/ordonnances/${r.id}`}><span className="mono">{r.number}</span> · {r.patientName}</Link><span className={`status rx-${r.status.toLowerCase()}`}>{rxStatusLabel(r.status)}</span></li>)}
            {!rx.data?.length && <li className="muted">Aucune ordonnance</li>}
          </ul>
        </div>
      </section>
    </>
  );
}
