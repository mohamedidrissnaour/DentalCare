import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, qs } from "../../lib/api";
import { useSession } from "../../lib/session";
import { Icon } from "../../components/Icon";
import { RxPaper } from "../../components/RxPaper";
import { money, dDate, dTime } from "../../lib/format";
import { PaymentMethods, patientFullName, userTitle, fmtDay, parseDt } from "../../../../shared/domain";

/**
 * Pages imprimables. Paramètres : mark=1 (marque l'ordonnance « imprimée »), auto=1 (lance l'impression dès que prêt).
 * Quand la page est prête, <body data-ready="1"> : l'application de bureau imprime alors sans boîte de dialogue.
 */
function usePrintReady(ready: boolean) {
  const [params] = useSearchParams();
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    document.body.dataset.ready = "1";
    if (params.get("auto") === "1") setTimeout(() => window.print(), 300);
    return () => { delete document.body.dataset.ready; };
  }, [ready, params]);
}
function PrintBar({ back }: { back: string }) {
  return (
    <div className="print-bar no-print">
      <button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon n="imprimante" /> Imprimer</button>
      <Link className="btn" to={back}>Retour</Link>
    </div>
  );
}

export function PrintRx() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { ref, reloadRef } = useSession();
  const [d, setD] = useState<any>(undefined);
  useEffect(() => {
    (async () => {
      try {
        if (params.get("mark") === "1") await api.post(`/rx/${id}/printed`);
        const r = await api.get(`/rx/${id}`);
        if (!r || r.rx.status === "Annulee") { setD(null); return; }
        const patient = await api.get(`/patients/${r.rx.patientId}`);
        setD({ ...r, patient });
      } catch { setD(null); }
    })();
    if (!ref) reloadRef();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const doctor = d && ref ? ref.doctors.find((x) => x.id === d.rx.doctorId) ?? { fullName: d.rx.doctorName, role: "Docteur" } : null;
  usePrintReady(!!d && !!ref);
  useEffect(() => { document.title = d?.rx?.number ?? "Ordonnance"; }, [d]);
  if (d === null) return <p className="print-missing">Ordonnance introuvable.</p>;
  if (!d || !ref) return null;
  return (
    <div className="print-root">
      <div className="sheet ordonnance">
        <RxPaper cabinet={ref.settings} doctor={doctor} patient={d.patient} date={d.rx.sentAt ?? d.rx.createdAt} items={d.items} notes={d.rx.notes} number={d.rx.number} duplicate={d.rx.printCount > 1} />
      </div>
      <PrintBar back={`/ordonnances/${id}`} />
    </div>
  );
}

export function PrintInvoice() {
  const { id } = useParams();
  const { ref, reloadRef } = useSession();
  const [d, setD] = useState<any>(undefined);
  useEffect(() => {
    (async () => {
      try { const r = await api.get(`/billing/invoices/${id}`); if (!r.invoice) { setD(null); return; } setD({ ...r, patient: await api.get(`/patients/${r.invoice.patientId}`) }); }
      catch { setD(null); }
    })();
    if (!ref) reloadRef();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  usePrintReady(!!d && !!ref);
  if (d === null) return <p className="print-missing">Facture introuvable.</p>;
  if (!d || !ref) return null;
  const s = ref.settings, inv = d.invoice, p = d.patient, doc = ref.doctors.find((x) => x.id === inv.doctorId);
  document.title = `Facture ${inv.number}`;
  return (
    <div className="print-root">
      <article className="sheet facture">
        <header className="sheet-head">
          <div className="cab"><b>{s.name}</b><span>{s.address}</span><span>{s.postalCode} {s.city}</span>{s.siret && <span>SIRET {s.siret}</span>}</div>
          <div className="doc"><b>FACTURE {inv.number}</b><span>Date : {dDate(inv.issuedAt)}</span><span>Praticien : {doc ? userTitle(doc) : "Dr " + inv.doctorName}</span></div>
        </header>
        <div className="sheet-patient"><b>{patientFullName(p)}</b><span>{p.address} {p.postalCode} {p.city}</span></div>
        <table className="sheet-table">
          <thead><tr><th>Désignation</th><th>Dent</th><th>Qté</th><th className="num">P.U.</th><th className="num">Montant</th></tr></thead>
          <tbody>{d.lines.map((l: any) => <tr key={l.id}><td>{l.label}</td><td>{l.tooth ?? ""}</td><td>{l.qty}</td><td className="num">{money(l.unitPrice)}</td><td className="num">{money(l.qty * l.unitPrice)}</td></tr>)}</tbody>
          <tfoot>
            <tr><td colSpan={4}>Total</td><td className="num">{money(inv.total)}</td></tr>
            <tr><td colSpan={4}>Déjà réglé</td><td className="num">{money(inv.paid)}</td></tr>
            <tr className="strong"><td colSpan={4}>Reste dû</td><td className="num">{money(Math.max(0, inv.total - inv.paid))}</td></tr>
          </tfoot>
        </table>
        {d.payments.length > 0 && <p className="sheet-notes">Règlements : {d.payments.map((x: any) => `${dDate(x.paidAt)} ${x.method} ${money(x.amount)}`).join(" · ")}</p>}
        <footer className="sheet-foot"><span>{inv.status === "Payee" ? "Acquittée, merci de votre confiance." : "Merci de votre confiance."}</span></footer>
      </article>
      <PrintBar back="/facturation" />
    </div>
  );
}

export function PrintCash() {
  const [params] = useSearchParams();
  const { ref, reloadRef } = useSession();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get("jour") ?? "") ? params.get("jour")! : fmtDay(new Date());
  const [lines, setLines] = useState<any[] | null | undefined>(undefined);
  useEffect(() => { api.get(`/followup/cash${qs({ day })}`).then(setLines).catch(() => setLines(null)); if (!ref) reloadRef(); }, [day]); // eslint-disable-line react-hooks/exhaustive-deps
  usePrintReady(!!lines && !!ref);
  if (lines === null) return <p className="print-missing">Accès refusé.</p>;
  if (!lines || !ref) return null;
  const s = ref.settings, total = lines.reduce((a, x) => a + x.amount, 0);
  document.title = `Journal de caisse ${dDate(day)}`;
  return (
    <div className="print-root">
      <article className="sheet">
        <header className="sheet-head">
          <div className="doc"><b>{s.name}</b><span>{s.address}</span><span>{s.postalCode} {s.city}</span></div>
          <div className="cab"><b>Journal de caisse</b><span>{parseDt(day)!.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span><span>Édité le {new Date().toLocaleString("fr-FR")}</span></div>
        </header>
        <table className="sheet-table">
          <thead><tr><th>Mode de paiement</th><th className="num">Nombre</th><th className="num">Montant</th></tr></thead>
          <tbody>{PaymentMethods.map((m) => { const x = lines.filter((l) => l.method === m); return <tr key={m}><td>{m}</td><td className="num">{x.length}</td><td className="num">{money(x.reduce((a, l) => a + l.amount, 0))}</td></tr>; })}</tbody>
          <tfoot><tr className="strong"><td>Total</td><td className="num">{lines.length}</td><td className="num">{money(total)}</td></tr></tfoot>
        </table>
        <table className="sheet-table">
          <thead><tr><th>Heure</th><th>Patient</th><th>Facture</th><th>Mode</th><th className="num">Montant</th></tr></thead>
          <tbody>{lines.map((l) => <tr key={l.id}><td>{dTime(l.paidAt)}</td><td>{l.patientName}</td><td>{l.invoiceNumber}</td><td>{l.method}</td><td className="num">{money(l.amount)}</td></tr>)}</tbody>
        </table>
        <footer className="sheet-foot"><span>Signature :</span><span>{s.name}</span></footer>
      </article>
      <PrintBar back={`/caisse?jour=${day}`} />
    </div>
  );
}
