import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSession } from "../lib/session";
import { api } from "../lib/api";
import { useToasts } from "../lib/toasts";
import { Icon } from "../components/Icon";
import { Alerts, Loader, Modal, PageHead, PageLoader } from "../components/ui";
import { PatientPicker } from "../components/PatientPicker";
import { RxPaper } from "../components/RxPaper";
import { P, fmtDateTime } from "../../../shared/domain";
import { MAX_ITEMS, validateRx } from "../../../shared/rx";

const blank = () => ({ key: Math.random(), medication: "", dosage: "", frequency: "", duration: "", quantity: "", instructions: "" });

export function RxEdit() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { me, can, ref } = useSession();
  const toasts = useToasts();
  const nav = useNavigate();
  const [catalog, setCatalog] = useState<any>(null);
  const [patient, setPatient] = useState<any>(null);
  const [model, setModel] = useState<any>({ id: 0, targetSecretaryId: "", urgent: false, notes: "" });
  const [items, setItems] = useState<any[]>([blank()]);
  const [errors, setErrors] = useState<string[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState<{ name: string; desc: string } | null>(null);
  useEffect(() => {
    api.get("/rx/catalog").then(setCatalog);
    if (id) api.get(`/rx/${id}`).then((r) => {
      if (!r || r.rx.status !== "Brouillon") { nav(`/ordonnances/${id}`); return; }
      setModel({ id: r.rx.id, targetSecretaryId: r.rx.targetSecretaryId ?? "", urgent: !!r.rx.urgent, notes: r.rx.notes ?? "" });
      setItems(r.items.length ? r.items.map((i: any) => ({ ...blank(), ...i })) : [blank()]);
      api.get(`/patients/${r.rx.patientId}`).then(setPatient);
    });
    else if (params.get("patient")) api.get(`/patients/${params.get("patient")}`).then(setPatient).catch(() => undefined);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can(P.RxWrite)) return <Navigate to="/ordonnances" replace />;
  if (!catalog) return <PageLoader />;

  // Pendant la saisie : seulement les alertes (allergies) ; les erreurs bloquantes s'affichent à l'envoi.
  const warnings = patient ? validateRx(model.notes, items, patient).warnings : [];
  const setItem = (i: number, k: string, v: string) => setItems((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const fillDefaults = (i: number) => setItems((l) => l.map((x, j) => {
    if (j !== i) return x;
    const m = catalog.medications.find((mm: any) => mm.name.toLowerCase() === x.medication.trim().toLowerCase());
    return m ? { ...x, dosage: x.dosage || m.defaultDosage || "", frequency: x.frequency || m.defaultFrequency || "", duration: x.duration || m.defaultDuration || "" } : x;
  }));
  const applyTemplate = (t: any) => {
    setItems((l) => [...l.filter((x) => x.medication.trim()), ...t.items.map((i: any) => ({ ...blank(), ...i }))].slice(0, MAX_ITEMS));
    toasts.show("info", `Modèle « ${t.name} » ajouté`);
  };
  const save = async (send: boolean) => {
    setBusy(true); setErrors([]);
    try {
      const r = await api.post("/rx", { rx: { ...model, patientId: patient?.id ?? 0, targetSecretaryId: Number(model.targetSecretaryId) || null, items }, send, ack });
      if (r.needAck) { setErrors(["Confirmez les alertes avant l'envoi."]); return; }
      if (send) toasts.show("success", "Ordonnance envoyée", "Le secrétariat vient d'être notifié."); else toasts.success("Brouillon enregistré");
      nav(`/ordonnances/${r.id}`);
    } catch (e: any) { setErrors([e.message]); } finally { setBusy(false); }
  };
  const saveTemplate = async () => {
    try { await api.post("/rx-templates", { name: tpl!.name, description: tpl!.desc, items }); toasts.success("Modèle enregistré", tpl!.name); setTpl(null); setCatalog(await api.get("/rx/catalog")); }
    catch (e: any) { toasts.error(e.message); }
  };

  return (
    <>
      <PageHead title={id ? "Modifier l'ordonnance" : "Nouvelle ordonnance"} sub="Rédigez, puis envoyez au secrétariat : la secrétaire reçoit une notification et imprime." />
      <div className="rx-layout">
        <div className="rx-form">
          <div className="card"><h3>1 · Patient</h3><PatientPicker patient={patient} onPick={setPatient} autoFocus /></div>
          <div className="card">
            <header className="card-head"><h3>2 · Modèles rapides</h3></header>
            <div className="templates">{catalog.templates.map((t: any) => (
              <button key={t.id} className="tpl" onClick={() => applyTemplate(t)} title={t.description}><span className="tpl-ico"><Icon n="ordonnance" /></span><b>{t.name}</b><small>{t.description}</small></button>
            ))}</div>
          </div>
          <div className="card">
            <header className="card-head"><h3>3 · Médicaments</h3>
              <button className="btn btn-sm" onClick={() => setItems((l) => [...l, blank()])} disabled={items.length >= MAX_ITEMS}><Icon n="plus" /> Ligne</button></header>
            <datalist id="meds">{catalog.medications.map((m: any) => <option key={m.id} value={m.name}>{m.form}</option>)}</datalist>
            {items.map((it, i) => (
              <div className="rx-line slide-in" key={it.key}>
                <span className="rx-num">{i + 1}</span>
                <div className="rx-fields">
                  <input className="rx-med" list="meds" placeholder="Médicament" value={it.medication} maxLength={120} onChange={(e) => setItem(i, "medication", e.target.value)} onBlur={() => fillDefaults(i)} />
                  <div className="grid4">
                    <input placeholder="Posologie *" value={it.dosage ?? ""} maxLength={200} onChange={(e) => setItem(i, "dosage", e.target.value)} />
                    <input placeholder="Fréquence" value={it.frequency ?? ""} maxLength={200} onChange={(e) => setItem(i, "frequency", e.target.value)} />
                    <input placeholder="Durée *" value={it.duration ?? ""} maxLength={200} onChange={(e) => setItem(i, "duration", e.target.value)} />
                    <input placeholder="Quantité" value={it.quantity ?? ""} maxLength={200} onChange={(e) => setItem(i, "quantity", e.target.value)} />
                  </div>
                  <input placeholder="Instructions (ex. au cours des repas)" value={it.instructions ?? ""} maxLength={200} onChange={(e) => setItem(i, "instructions", e.target.value)} />
                </div>
                <div className="rx-line-actions">
                  <button className="icon-btn" title="Monter" disabled={i === 0} onClick={() => setItems((l) => { const c = [...l]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; })}>▲</button>
                  <button className="icon-btn" title="Supprimer" onClick={() => setItems((l) => { const c = l.filter((_, j) => j !== i); return c.length ? c : [blank()]; })}><Icon n="corbeille" /></button>
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            <h3>4 · Envoi</h3>
            <div className="grid2">
              <label>Destinataire
                <select value={model.targetSecretaryId} onChange={(e) => setModel({ ...model, targetSecretaryId: e.target.value })}>
                  <option value="">Toutes les secrétaires</option>
                  {ref?.secretaries.map((s) => <option key={s.id} value={s.id}>{s.fullName} {s.autoPrint ? "(impression auto)" : ""}</option>)}
                </select>
              </label>
              <label className="check big"><input type="checkbox" checked={model.urgent} onChange={(e) => setModel({ ...model, urgent: e.target.checked })} /> <Icon n="alerte" /> Urgente (prioritaire dans la file)</label>
            </div>
            <label>Remarques imprimées<textarea rows={2} maxLength={1000} value={model.notes} onChange={(e) => setModel({ ...model, notes: e.target.value })} placeholder="Conseils post-opératoires…" /></label>
            <Alerts errors={errors} warnings={warnings} />
            {warnings.length > 0 && <label className="check warn-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> J'ai pris connaissance des alertes et je confirme la prescription.</label>}
            <div className="rx-actions">
              <button className="btn" onClick={() => setTpl({ name: "", desc: "" })}>Enregistrer comme modèle</button>
              <button className="btn" disabled={busy} onClick={() => save(false)}><Icon n="sauvegarde" /> Brouillon</button>
              <button className="btn btn-primary send" disabled={busy} onClick={() => save(true)}>{busy ? <Loader small /> : <span><Icon n="envoyer" /> Envoyer au secrétariat</span>}</button>
            </div>
          </div>
        </div>
        <aside className="rx-preview">
          <div className="rx-preview-box"><RxPaper cabinet={ref?.settings ?? {}} doctor={me} patient={patient} date={fmtDateTime(new Date())} items={items} notes={model.notes} mini /></div>
          <p className="muted center">Aperçu en direct</p>
        </aside>
      </div>
      <Modal open={!!tpl} onClose={() => setTpl(null)} title="Enregistrer comme modèle" footer={<><button className="btn" onClick={() => setTpl(null)}>Annuler</button><button className="btn btn-primary" onClick={saveTemplate}>Enregistrer</button></>}>
        {tpl && <div className="form">
          <label>Nom du modèle<input value={tpl.name} maxLength={60} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} /></label>
          <label>Description<input value={tpl.desc} maxLength={120} onChange={(e) => setTpl({ ...tpl, desc: e.target.value })} /></label>
        </div>}
      </Modal>
    </>
  );
}
