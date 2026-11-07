import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { qs } from "../lib/api";
import { Icon } from "../components/Icon";
import { Denied, PageHead, PageLoader } from "../components/ui";
import { money, dTime } from "../lib/format";
import { PaymentMethods, fmtDay, parseDt } from "../../../shared/domain";

export function Cash() {
  const [params] = useSearchParams();
  const today = fmtDay(new Date());
  const [day, setDay] = useState(() => { const p = params.get("jour"); return p && /^\d{4}-\d{2}-\d{2}$/.test(p) && p <= today ? p : today; });
  const lines = useApi<any[]>(`/followup/cash${qs({ day })}`);
  const move = (n: number) => { const d = parseDt(day)!; const x = fmtDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); if (x <= today) setDay(x); };
  if (lines.error?.status === 403) return <><PageHead title="Journal de caisse" /><Denied text="Votre profil n'a pas accès à l'encaissement." /></>;
  const l = lines.data;
  const total = (l ?? []).reduce((s, x) => s + x.amount, 0);
  return (
    <>
      <PageHead title="Journal de caisse" sub={`Encaissements du ${parseDt(day)!.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, par mode de paiement`}>
        <button className="btn" onClick={() => move(-1)} title="Jour précédent"><Icon n="chevron-gauche" /></button>
        <input type="date" className="input" value={day} max={today} onChange={(e) => e.target.value && e.target.value <= today && setDay(e.target.value)} />
        <button className="btn" onClick={() => move(1)} disabled={day >= today} title="Jour suivant"><Icon n="chevron" /></button>
        <button className="btn" onClick={() => setDay(today)}>Aujourd'hui</button>
        <a className="btn btn-primary" href={`/impression/caisse?jour=${day}`} target="_blank" rel="noreferrer"><Icon n="imprimante" /> Imprimer</a>
      </PageHead>
      {!l ? <PageLoader /> : <>
        <section className="kpis">
          <div className="kpi"><div><small>Total encaissé</small><b>{money(total)}</b><em>{l.length} règlement(s)</em></div></div>
          {PaymentMethods.map((m) => { const s = l.filter((x) => x.method === m); const sum = s.reduce((a, x) => a + x.amount, 0);
            return <div className="kpi" key={m}><div><small>{m}</small><b className={sum === 0 ? "muted" : ""}>{money(sum)}</b><em>{s.length} règlement(s)</em></div></div>; })}
        </section>
        <div className="card flush">
          <header className="card-head"><h3>Détail des encaissements</h3></header>
          <table className="table">
            <thead><tr><th>Heure</th><th>Patient</th><th>Facture</th><th>Praticien</th><th>Mode</th><th>Reçu par</th><th className="num">Montant</th></tr></thead>
            <tbody>
              {l.map((x) => <tr key={x.id}><td className="num-l">{dTime(x.paidAt)}</td><td><Link className="link" to={`/patients/${x.patientId}`}>{x.patientName}</Link></td>
                <td><Link className="link" to={`/facturation?facture=${x.invoiceId}`}>{x.invoiceNumber}</Link></td><td>Dr {x.doctorName}</td><td><span className="chip">{x.method}</span></td>
                <td className="muted">{x.receivedByName}</td><td className="num strong">{money(x.amount)}</td></tr>)}
              {!l.length && <tr><td colSpan={7} className="muted center">Aucun encaissement ce jour-là</td></tr>}
            </tbody>
            {l.length > 0 && <tfoot><tr className="strong"><td colSpan={6}>Total</td><td className="num">{money(total)}</td></tr></tfoot>}
          </table>
        </div>
      </>}
    </>
  );
}
