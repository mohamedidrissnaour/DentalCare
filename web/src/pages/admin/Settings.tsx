import { useEffect, useState } from "react";
import { useSession } from "../../lib/session";
import { api } from "../../lib/api";
import { useToasts } from "../../lib/toasts";
import { Icon } from "../../components/Icon";
import { Alerts, Denied, PageHead, PageLoader } from "../../components/ui";

const TABS: [string, string][] = [["cabinet", "Cabinet & règles"], ["actes", "Actes & tarifs"], ["meds", "Médicaments"], ["modeles", "Modèles"], ["systeme", "Système"]];
const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

export function Settings() {
  const { reloadRef } = useSession();
  const toasts = useToasts();
  const [tab, setTab] = useState("cabinet");
  const [s, setS] = useState<any>(null); const [canSeed, setCanSeed] = useState(false);
  const [acts, setActs] = useState<any[]>([]); const [meds, setMeds] = useState<any[]>([]); const [tpls, setTpls] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null); const [denied, setDenied] = useState(false); const [seeding, setSeeding] = useState(false);
  const load = async () => {
    try {
      const r = await api.get("/admin/settings"); setS(r.settings); setCanSeed(r.canSeedDemo);
      setActs((await api.get("/ref")).actTypes); setMeds(await api.get("/admin/medications")); setTpls((await api.get("/rx/catalog")).templates);
    } catch (e: any) { if (e.status === 403) setDenied(true); }
  };
  useEffect(() => { load(); }, []);
  if (denied) return <Denied />;
  if (!s) return <PageLoader />;
  const set = (k: string, v: any) => setS((x: any) => ({ ...x, [k]: v }));
  const saveSettings = async (next = s) => { try { setS(await api.put("/admin/settings", next)); setErr(null); toasts.success("Paramètres enregistrés"); reloadRef(); } catch (e: any) { setErr(e.message); } };
  const upd = (list: any[], setList: (l: any[]) => void, i: number, k: string, v: any) => setList(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const saveAct = async (a: any) => { try { await api.post("/admin/acts", { ...a, durationMin: Number(a.durationMin), price: Number(a.price) }); toasts.success("Acte enregistré", a.label); reloadRef(); load(); } catch (e: any) { toasts.error(e.message); } };
  const saveMed = async (m: any) => { try { await api.post("/admin/medications", m); toasts.success("Médicament enregistré", m.name); load(); } catch (e: any) { toasts.error(e.message); } };

  return (
    <>
      <PageHead title="Paramètres & référentiels" sub="Tout le fonctionnement du cabinet se règle ici." />
      <nav className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <div className="tab-body" key={tab}>
        {tab === "cabinet" && <>
          <div className="grid-2col">
            <div className="card"><h3>Cabinet (en-tête des ordonnances et factures)</h3>
              <div className="form">
                <label>Nom<input value={s.name} maxLength={100} onChange={(e) => set("name", e.target.value)} /></label>
                <label>Adresse<input value={s.address} maxLength={120} onChange={(e) => set("address", e.target.value)} /></label>
                <div className="grid2">
                  <label>Code postal<input value={s.postalCode} maxLength={5} onChange={(e) => set("postalCode", e.target.value)} /></label>
                  <label>Ville<input value={s.city} maxLength={60} onChange={(e) => set("city", e.target.value)} /></label>
                  <label>Téléphone<input value={s.phone} maxLength={20} onChange={(e) => set("phone", e.target.value)} /></label>
                  <label>Fax<input value={s.fax} maxLength={20} onChange={(e) => set("fax", e.target.value)} /></label>
                  <label>E-mail<input value={s.email} maxLength={120} onChange={(e) => set("email", e.target.value)} /></label>
                  <label>SIRET<input value={s.siret} maxLength={14} onChange={(e) => set("siret", e.target.value)} /></label>
                </div>
                <label>Mention en bas d'ordonnance<textarea rows={2} maxLength={300} value={s.rxFooter} onChange={(e) => set("rxFooter", e.target.value)} /></label>
              </div>
            </div>
            <div className="card"><h3>Horaires d'ouverture</h3>
              <p className="hint">Format : 08:30-12:30,14:00-19:00 ; laisser vide = fermé.</p>
              <div className="form hours">{[1, 2, 3, 4, 5, 6, 0].map((i) => (
                <label key={i}><span>{DAYS[i]}</span><input value={s.hours[i]} maxLength={60} placeholder="fermé" onChange={(e) => set("hours", s.hours.map((h: string, j: number) => (j === i ? e.target.value : h)))} /></label>
              ))}</div>
              <h3>Règles de gestion</h3>
              <div className="form grid2">
                <label>Pas de l'agenda (min)<select value={s.slotMinutes} onChange={(e) => set("slotMinutes", Number(e.target.value))}>{[5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
                <label>Annulation tardive si &lt; (heures)<input type="number" min={0} max={168} value={s.lateCancelHours} onChange={(e) => set("lateCancelHours", Number(e.target.value))} /></label>
                <label>Alerte après N absences<input type="number" min={1} max={20} value={s.noShowAlertThreshold} onChange={(e) => set("noShowAlertThreshold", Number(e.target.value))} /></label>
                <label>Conserver les sauvegardes (jours)<input type="number" min={1} max={365} value={s.backupRetentionDays} onChange={(e) => set("backupRetentionDays", Number(e.target.value))} /></label>
              </div>
            </div>
          </div>
          <Alerts errors={err} />
          <button className="btn btn-primary" onClick={() => saveSettings()}><Icon n="sauvegarde" /> Enregistrer les paramètres</button>
        </>}
        {tab === "actes" && (
          <div className="card">
            <header className="card-head"><h3>Actes & tarifs</h3><button className="btn btn-sm" onClick={() => setActs([{ id: 0, code: "", label: "", durationMin: 30, price: 0, color: "#14B1BB", active: 1 }, ...acts])}><Icon n="plus" /> Acte</button></header>
            <table className="table edit">
              <thead><tr><th>Code</th><th>Libellé</th><th>Durée</th><th>Tarif (€)</th><th>Couleur</th><th>Actif</th><th></th></tr></thead>
              <tbody>{acts.map((a, i) => (
                <tr key={a.id || "n" + i}>
                  <td><input value={a.code} maxLength={8} style={{ width: 80 }} onChange={(e) => upd(acts, setActs, i, "code", e.target.value)} /></td>
                  <td><input value={a.label} maxLength={80} onChange={(e) => upd(acts, setActs, i, "label", e.target.value)} /></td>
                  <td><input type="number" min={5} max={240} value={a.durationMin} style={{ width: 80 }} onChange={(e) => upd(acts, setActs, i, "durationMin", e.target.value)} /></td>
                  <td><input type="number" min={0} step={0.01} value={a.price} style={{ width: 110 }} onChange={(e) => upd(acts, setActs, i, "price", e.target.value)} /></td>
                  <td><input type="color" value={a.color} onChange={(e) => upd(acts, setActs, i, "color", e.target.value)} /></td>
                  <td><input type="checkbox" checked={!!a.active} onChange={(e) => upd(acts, setActs, i, "active", e.target.checked)} /></td>
                  <td><button className="btn btn-sm" onClick={() => saveAct(a)} title="Enregistrer"><Icon n="sauvegarde" /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {tab === "meds" && (
          <div className="card">
            <header className="card-head"><h3>Médicaments (catalogue de l'ordonnance)</h3><button className="btn btn-sm" onClick={() => setMeds([{ id: 0, name: "", form: "", defaultDosage: "", defaultFrequency: "", defaultDuration: "", active: 1 }, ...meds])}><Icon n="plus" /> Médicament</button></header>
            <table className="table edit">
              <thead><tr><th>Nom</th><th>Forme</th><th>Posologie par défaut</th><th>Fréquence</th><th>Durée</th><th>Actif</th><th></th></tr></thead>
              <tbody>{meds.map((m, i) => (
                <tr key={m.id || "n" + i}>
                  <td><input value={m.name} maxLength={120} onChange={(e) => upd(meds, setMeds, i, "name", e.target.value)} /></td>
                  <td><input value={m.form ?? ""} maxLength={40} style={{ width: 110 }} onChange={(e) => upd(meds, setMeds, i, "form", e.target.value)} /></td>
                  <td><input value={m.defaultDosage ?? ""} maxLength={80} onChange={(e) => upd(meds, setMeds, i, "defaultDosage", e.target.value)} /></td>
                  <td><input value={m.defaultFrequency ?? ""} maxLength={80} onChange={(e) => upd(meds, setMeds, i, "defaultFrequency", e.target.value)} /></td>
                  <td><input value={m.defaultDuration ?? ""} maxLength={40} style={{ width: 100 }} onChange={(e) => upd(meds, setMeds, i, "defaultDuration", e.target.value)} /></td>
                  <td><input type="checkbox" checked={!!m.active} onChange={(e) => upd(meds, setMeds, i, "active", e.target.checked)} /></td>
                  <td><button className="btn btn-sm" onClick={() => saveMed(m)} title="Enregistrer"><Icon n="sauvegarde" /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {tab === "modeles" && (
          <div className="card"><h3>Modèles d'ordonnance</h3>
            <p className="hint">Créez un modèle depuis l'écran « Nouvelle ordonnance », bouton « Enregistrer comme modèle ».</p>
            <div className="templates">{tpls.map((t) => (
              <div key={t.id} className="tpl static">
                <span className="tpl-ico"><Icon n="ordonnance" /></span><b>{t.name}</b><small>{t.description}</small>
                <small className="muted">{t.items.length} médicament(s)</small>
                <button className="btn btn-sm btn-danger-ghost" onClick={async () => { try { await api.del(`/rx-templates/${t.id}`); toasts.success("Modèle supprimé"); load(); } catch (e: any) { toasts.error(e.message); } }}>Supprimer</button>
              </div>
            ))}</div>
          </div>
        )}
        {tab === "systeme" && (
          <div className="grid-2col">
            <div className="card"><h3>Mode maintenance</h3>
              <p>Bloque l'accès à tous les postes sauf le vôtre (mise à jour, restauration…).</p>
              <label className="switch"><input type="checkbox" checked={!!s.maintenanceMode} onChange={(e) => saveSettings({ ...s, maintenanceMode: e.target.checked })} /><span></span> {s.maintenanceMode ? "Activé" : "Désactivé"}</label>
            </div>
            <div className="card"><h3>Données de démonstration</h3>
              <p>Charge environ 35 patients <b>fictifs</b>, des rendez-vous sur un mois, des soins et des factures : idéal pour se former ou faire une démo.</p>
              {canSeed ? <button className="btn btn-primary" disabled={seeding} onClick={async () => {
                setSeeding(true);
                try { const r = await api.post("/admin/demo"); toasts.success("Démo chargée", `${r.count} patients fictifs`); load(); } catch (e: any) { toasts.error(e.message); } finally { setSeeding(false); }
              }}>{seeding ? "Chargement…" : "Charger la démo"}</button> : <p className="hint">Indisponible : la base contient déjà des patients.</p>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
