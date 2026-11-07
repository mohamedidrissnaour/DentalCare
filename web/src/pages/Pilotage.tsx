import { useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../lib/session";
import { useApi } from "../lib/hooks";
import { qs } from "../lib/api";
import { Icon } from "../components/Icon";
import { Denied, PageHead, PageLoader } from "../components/ui";
import { Donut, BarChart } from "../components/charts";
import { money } from "../lib/format";
import { P, Roles, fmtDay } from "../../../shared/domain";

const PERIODS: [string, string][] = [["mois", "Ce mois"], ["trimestre", "3 mois"], ["annee", "12 mois"]];

export function Pilotage() {
  const { can } = useSession();
  const [period, setPeriod] = useState("mois");
  const all = can(P.PilotageAll), denied = !can(P.PilotageOwn) && !all;
  const t = new Date(), m = new Date(t.getFullYear(), t.getMonth(), 1);
  const from = period === "trimestre" ? new Date(m.getFullYear(), m.getMonth() - 2, 1) : period === "annee" ? new Date(m.getFullYear(), m.getMonth() - 11, 1) : m;
  const to = new Date(m.getFullYear(), m.getMonth() + 1, 1);
  const d = useApi<any>(denied ? null : `/pilotage${qs({ from: fmtDay(from), to: fmtDay(to) })}`, [period]);
  const label = `du ${from.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })} au ${new Date(to.getTime() - 86400000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}`;
  const head = (
    <PageHead title={all ? "Pilotage du cabinet" : "Mes indicateurs"} sub={`${all ? "Vue d'ensemble et performance de chaque praticien" : "Votre activité personnelle"} · ${label}`}>
      <div className="seg">{PERIODS.map(([k, l]) => <button key={k} className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>)}</div>
    </PageHead>
  );
  if (denied) return <>{head}<Denied text="Votre profil n'a pas accès aux indicateurs." /></>;
  if (!d.data) return <>{head}<PageLoader /></>;
  const s: any[] = d.data.doctors, debtors: any[] = d.data.debtors;
  const care = s.reduce((a, x) => a + x.care, 0), collected = s.reduce((a, x) => a + x.collected, 0);
  const appts = s.reduce((a, x) => a + x.appointments, 0), noShows = s.reduce((a, x) => a + x.noShows, 0);
  const waits = s.filter((x) => x.avgWaitMin > 0).map((x) => x.avgWaitMin);
  return (
    <>
      {head}
      <section className="kpis">
        <div className="kpi kpi-ico"><span className="kpi-icon blue"><Icon n="consultation" size={20} /></span><div><small>Actes réalisés</small><b>{money(care)}</b><em>{s.reduce((a, x) => a + x.patientsSeen, 0)} patient(s) soigné(s)</em></div></div>
        <div className="kpi kpi-ico"><span className="kpi-icon green"><Icon n="euro" size={20} /></span><div><small>Encaissé</small><b>{money(collected)}</b><em>règlements reçus sur la période</em></div></div>
        {all && <div className="kpi kpi-ico"><span className="kpi-icon gray"><Icon n="facture" size={20} /></span><div><small>Reste à encaisser (total)</small><b>{money(debtors.reduce((a, x) => a + x.due, 0))}</b><em>{debtors.length} patient(s) concerné(s)</em></div></div>}
        <div className="kpi kpi-ico"><span className="kpi-icon blue"><Icon n="calendrier" size={20} /></span><div><small>Rendez-vous</small><b>{appts}</b><em>{appts ? Math.floor((noShows * 100) / appts) : 0} % d'absences</em></div></div>
        <div className="kpi kpi-ico"><span className="kpi-icon green"><Icon n="horloge" size={20} /></span><div><small>Attente moyenne</small><b>{waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0} min</b><em>{s.reduce((a, x) => a + x.visits, 0)} passage(s) terminé(s)</em></div></div>
      </section>
      <div className="card flush">
        <header className="card-head"><h3>Performance par praticien</h3></header>
        <div className="scroll-x"><table className="table">
          <thead><tr><th>Praticien</th><th className="num">Rendez-vous</th><th className="num">Patients soignés</th><th className="num">Actes</th><th className="num">Encaissé</th><th className="num">Panier moyen</th><th className="num">Absences</th><th className="num">Soins en cours</th><th className="num">Attente moy.</th><th style={{ width: "18%" }}>Part du chiffre</th></tr></thead>
          <tbody>{s.map((x) => (
            <tr key={x.doctorId}>
              <td><span className="doc-tag" style={{ ["--c" as any]: x.color }}>Dr {x.name}</span> {x.role === Roles.Principal && <span className="role-tag role-principal">Principal</span>}</td>
              <td className="num">{x.appointments}</td><td className="num">{x.patientsSeen}</td><td className="num strong">{money(x.care)}</td><td className="num">{money(x.collected)}</td>
              <td className="num">{money(x.avgTicket)}</td><td className={"num" + (x.noShowRate > 10 ? " money-due" : "")}>{x.noShowRate} %</td><td className="num">{x.openPlans}</td>
              <td className="num">{Math.round(x.avgWaitMin)} min</td>
              <td><div className="meter"><i style={{ width: `${care ? Math.floor((x.care * 100) / care) : 0}%`, background: x.color }}></i></div></td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      <section className="grid-dash">
        <div className="card"><header className="card-head"><h3>Chiffre par praticien</h3></header>
          <Donut data={s.map((x) => ({ label: `Dr ${x.name}`, value: x.care, color: x.color }))} centerLabel="€" centerValue={Math.round(care).toLocaleString("fr-FR")} money /></div>
        <div className="card"><header className="card-head"><h3>Encaissé par praticien</h3></header>
          <BarChart data={s.map((x) => ({ label: x.name.split(" ").pop(), value: x.collected }))} money /></div>
        {all && <div className="card flush">
          <header className="card-head"><h3>Impayés à relancer</h3><Link className="link" to="/rappels">Patients à rappeler</Link></header>
          <ul className="mini-list">
            {debtors.map((x) => <li key={x.id}><Link to={`/patients/${x.id}`}><b>{x.name}</b><small className="block muted">{x.phone}</small></Link><b className="num money-due">{money(x.due)}</b></li>)}
            {!debtors.length && <li className="muted">Aucun impayé</li>}
          </ul>
        </div>}
      </section>
    </>
  );
}
