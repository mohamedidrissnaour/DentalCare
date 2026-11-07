import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSession, useLive } from "../lib/session";
import { api, qs } from "../lib/api";
import { useToasts } from "../lib/toasts";
import { Icon } from "../components/Icon";
import { Alerts, Modal, PageHead, PageLoader } from "../components/ui";
import { money, dDate, dDayTime } from "../lib/format";
import { P, PaymentMethods, invoiceStatusLabel } from "../../../shared/domain";

const FILTERS: [string | null, string][] = [[null, "Toutes"], ["Impayee", "Impayées"], ["Partielle", "Partielles"], ["Payee", "Payées"], ["Annulee", "Annulées"]];

export function Billing() {
  const { can } = useSession();
  const toasts = useToasts();
  const [params] = useSearchParams();
  const canCollect = can(P.BillingCollect);
  const [tab, setTab] = useState("todo");
  const [status, setStatus] = useState<string | null>(null);
  const [unbilled, setUnbilled] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [invoices, setInvoices] = useState<any[]>([]);
  const [open, setOpen] = useState<any>(null);
  const [method, setMethod] = useState("CB");
  const [amount, setAmount] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const load = async (first = false) => {
    let u = await api.get<any[]>("/billing/unbilled");
    const pid = Number(params.get("patient")) || 0;
    if (pid) u = [...u.filter((t) => t.patientId === pid), ...u.filter((t) => t.patientId !== pid)];
    setUnbilled(u); setSel(new Set(u.map((t) => t.id)));
    setInvoices(await api.get(`/billing/invoices${qs({ status })}`));
    if (first) { const inv = Number(params.get("facture")); if (inv) { setTab("inv"); openInv(inv); } else if (!u.length) setTab("inv"); }
  };
  useEffect(() => { load(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get(`/billing/invoices${qs({ status })}`).then(setInvoices); }, [status]);
  useLive(["visits"], () => load());

  const openInv = async (id: number) => { const r = await api.get(`/billing/invoices/${id}`); setOpen(r); setAmount(Math.max(0, r.invoice.total - r.invoice.paid)); setErr(null); };
  const create = async (patientId: number, ids: number[]) => {
    try { const r = await api.post("/billing/invoices", { patientId, treatmentIds: ids.filter((x) => sel.has(x)) }); toasts.success("Facture créée"); await load(); setTab("inv"); openInv(r.id); }
    catch (e: any) { toasts.error(e.message); }
  };
  const pay = async () => {
    try { await api.post(`/billing/invoices/${open.invoice.id}/payments`, { amount, method }); toasts.success("Encaissement enregistré", `${money(amount)} - ${method}`); openInv(open.invoice.id); api.get(`/billing/invoices${qs({ status })}`).then(setInvoices); }
    catch (e: any) { setErr(e.message); }
  };
  const cancel = async () => {
    try { await api.post(`/billing/invoices/${open.invoice.id}/cancel`); toasts.success("Facture annulée", "Les soins sont de nouveau « à facturer »."); setOpen(null); load(); }
    catch (e: any) { setErr(e.message); }
  };
  if (!unbilled) return <PageLoader />;
  const groups = [...new Map(unbilled.map((t) => [t.patientId, { patientId: t.patientId, patientName: t.patientName, items: unbilled.filter((x) => x.patientId === t.patientId) }])).values()];
  const inv = open?.invoice, remaining = inv ? Math.max(0, inv.total - inv.paid) : 0;

  return (
    <>
      <PageHead title="Facturation" sub="Soins à facturer, factures et encaissements." />
      <nav className="tabs">
        <button className={tab === "todo" ? "on" : ""} onClick={() => setTab("todo")}><Icon n="facture" /> À facturer <em className="count-pill">{groups.length}</em></button>
        <button className={tab === "inv" ? "on" : ""} onClick={() => setTab("inv")}><Icon n="facture" /> Factures</button>
      </nav>
      {tab === "todo" ? <>
        {!groups.length && <div className="empty-state"><div className="empty-icon"><Icon n="valide" size={28} /></div><h2>Tous les soins sont facturés</h2></div>}
        {groups.map((g) => (
          <div className="card bill-group" key={g.patientId}>
            <header className="card-head"><h3><Link to={`/patients/${g.patientId}`}>{g.patientName}</Link></h3><b>{money(g.items.filter((t) => sel.has(t.id)).reduce((s, t) => s + t.price, 0))}</b></header>
            <table className="table"><tbody>{g.items.map((t) => (
              <tr key={t.id}>
                <td style={{ width: 32 }}><input type="checkbox" checked={sel.has(t.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })} /></td>
                <td>{dDate(t.performedAt)}</td><td><b>{t.label}</b> {t.tooth ? `· dent ${t.tooth}` : ""}</td><td>Dr {t.doctorName}</td><td className="num">{money(t.price)}</td>
              </tr>
            ))}</tbody></table>
            <button className="btn btn-primary" disabled={!canCollect || !g.items.some((t) => sel.has(t.id))} onClick={() => create(g.patientId, g.items.map((x) => x.id))}><Icon n="facture" /> Créer la facture</button>
          </div>
        ))}
      </> : <>
        <div className="filters">{FILTERS.map(([k, l]) => <button key={l} className={"pill" + (status === k ? " on" : "")} onClick={() => setStatus(k)}>{l}</button>)}</div>
        <div className="card"><table className="table">
          <thead><tr><th>N°</th><th>Date</th><th>Patient</th><th>Praticien</th><th className="num">Total</th><th className="num">Reste dû</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            {invoices.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => openInv(i.id)}>
                <td><b>{i.number}</b></td><td>{dDate(i.issuedAt)}</td><td>{i.patientName}</td><td>Dr {i.doctorName}</td>
                <td className="num">{money(i.total)}</td><td className="num">{money(Math.max(0, i.total - i.paid))}</td>
                <td><span className={`status inv-${i.status.toLowerCase()}`}>{invoiceStatusLabel(i.status)}</span></td><td>→</td>
              </tr>
            ))}
            {!invoices.length && <tr><td colSpan={8} className="center muted">Aucune facture</td></tr>}
          </tbody>
        </table></div>
      </>}

      <Modal open={!!inv} onClose={() => setOpen(null)} title={`Facture ${inv?.number ?? ""}`} wide footer={inv && <>
        {canCollect && inv.status !== "Annulee" && <button className="btn btn-danger-ghost" onClick={cancel}>Annuler la facture</button>}
        <a className="btn btn-primary" href={`/impression/facture/${inv.id}?auto=1`} target="_blank" rel="noreferrer"><Icon n="imprimante" /> Imprimer</a>
      </>}>
        {inv && <div className="invoice-view">
          <div className="inv-head"><div><b>{inv.patientName}</b><small>Dr {inv.doctorName} · {dDate(inv.issuedAt)}</small></div>
            <span className={`status big inv-${inv.status.toLowerCase()}`}>{invoiceStatusLabel(inv.status)}</span></div>
          <table className="table">
            <thead><tr><th>Désignation</th><th>Dent</th><th className="num">Montant</th></tr></thead>
            <tbody>{open.lines.map((l: any) => <tr key={l.id}><td>{l.label}</td><td>{l.tooth}</td><td className="num">{money(l.qty * l.unitPrice)}</td></tr>)}</tbody>
            <tfoot>
              <tr><td colSpan={2}>Total</td><td className="num">{money(inv.total)}</td></tr>
              <tr><td colSpan={2}>Réglé</td><td className="num">{money(inv.paid)}</td></tr>
              <tr className="strong"><td colSpan={2}>Reste dû</td><td className="num">{money(remaining)}</td></tr>
            </tfoot>
          </table>
          <div className="progress"><span style={{ width: `${inv.total === 0 ? 100 : Math.floor((inv.paid / inv.total) * 100)}%` }}></span></div>
          {open.payments.length > 0 && <><h4>Règlements</h4><ul className="mini-list">{open.payments.map((p: any) => <li key={p.id}>{dDayTime(p.paidAt)} · <b>{money(p.amount)}</b> · {p.method} <small className="muted">par {p.receivedByName}</small></li>)}</ul></>}
          {remaining > 0 && inv.status !== "Annulee" && (
            <div className="pay-box"><h4>Encaisser</h4>
              <div className="methods">{PaymentMethods.map((m) => <button key={m} className={"pill" + (method === m ? " on" : "")} onClick={() => setMethod(m)}>{m}</button>)}</div>
              <div className="row-inputs">
                <input type="number" min={0.01} step={0.01} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                <button className="btn" onClick={() => setAmount(remaining)}>Solde</button>
                <button className="btn btn-primary" disabled={!canCollect} onClick={pay}>Valider l'encaissement</button>
              </div>
            </div>
          )}
          <Alerts errors={err} />
        </div>}
      </Modal>
    </>
  );
}
