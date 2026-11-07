import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "../lib/session";
import { api } from "../lib/api";
import { useToasts } from "../lib/toasts";
import { Icon } from "../components/Icon";
import { Alerts, PageHead, PageLoader } from "../components/ui";
import { Roles, isDoctor, roleLabel, initials } from "../../../shared/domain";

export function Profile() {
  const { me, refresh } = useSession();
  const toasts = useToasts();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [f, setF] = useState<any>(null);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [e1, setE1] = useState<string | null>(null); const [e2, setE2] = useState<string | null>(null);
  useEffect(() => { if (me) setF({ fullName: me.fullName, email: me.email ?? "", phone: me.phone ?? "", rpps: me.rpps ?? "", specialty: me.specialty ?? "", color: me.color, autoPrint: me.autoPrint }); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me || !f) return <PageLoader />;
  const force = params.get("force") === "1" || me.mustChangePassword;
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const saveProfile = async () => { try { await api.put("/me/profile", f); toasts.success("Profil enregistré"); setE1(null); refresh(); } catch (e: any) { setE1(e.message); } };
  const changePw = async () => {
    try {
      await api.post("/me/password", pw);
      setPw({ current: "", next: "", confirm: "" }); setE2(null);
      toasts.success("Mot de passe changé", "Vos autres sessions ont été déconnectées.");
      await refresh(); nav("/");
    } catch (e: any) { setE2(e.message); }
  };
  return (
    <>
      <PageHead title="Mon profil" sub={<>{roleLabel(me.role)} · identifiant <b>{me.username}</b></>} />
      {force && <div className="alert alert-warn"><Icon n="cle" /> Pour votre sécurité, choisissez un nouveau mot de passe personnel avant de continuer.</div>}
      <div className="grid-2col">
        <div className="card">
          <h3>Informations</h3>
          <div className="form">
            <label>Nom complet<input value={f.fullName} maxLength={80} onChange={(e) => set("fullName", e.target.value)} disabled={force} /></label>
            <div className="grid2">
              <label>E-mail<input type="email" value={f.email} maxLength={120} onChange={(e) => set("email", e.target.value)} disabled={force} /></label>
              <label>Téléphone<input value={f.phone} maxLength={20} onChange={(e) => set("phone", e.target.value)} disabled={force} /></label>
            </div>
            {isDoctor(me.role) && <div className="grid2">
              <label>N° RPPS<input value={f.rpps} maxLength={11} onChange={(e) => set("rpps", e.target.value)} disabled={force} /></label>
              <label>Spécialité<input value={f.specialty} maxLength={60} onChange={(e) => set("specialty", e.target.value)} disabled={force} /></label>
            </div>}
            <label>Couleur dans l'agenda<div className="row-inputs"><input type="color" value={f.color} onChange={(e) => set("color", e.target.value)} disabled={force} /><span className="avatar" style={{ background: f.color }}>{initials(f.fullName)}</span></div></label>
            {me.role === Roles.Secretaire && <>
              <label className="check big"><input type="checkbox" checked={f.autoPrint} onChange={(e) => set("autoPrint", e.target.checked)} disabled={force} /> <Icon n="imprimante" /> Impression automatique des ordonnances reçues sur ce profil</label>
              <p className="hint">Dans l'application de bureau DentaCare, les ordonnances sortent directement sur l'imprimante par défaut, sans boîte de dialogue. Dans un navigateur, la fenêtre d'impression s'ouvre.</p>
            </>}
            <Alerts errors={e1} />
            <button className="btn btn-primary" onClick={saveProfile} disabled={force}><Icon n="sauvegarde" /> Enregistrer</button>
          </div>
        </div>
        <div className="card">
          <h3>Mot de passe</h3>
          <div className="form">
            <label>Mot de passe actuel<input type="password" value={pw.current} autoComplete="current-password" maxLength={128} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></label>
            <label>Nouveau mot de passe<input type="password" value={pw.next} autoComplete="new-password" maxLength={128} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></label>
            <label>Confirmation<input type="password" value={pw.confirm} autoComplete="new-password" maxLength={128} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></label>
            <p className="hint">10 caractères minimum, avec majuscule, minuscule et chiffre. Après le changement, vos autres sessions sont déconnectées.</p>
            <Alerts errors={e2} />
            <button className="btn btn-primary" onClick={changePw}>Changer le mot de passe</button>
          </div>
        </div>
      </div>
    </>
  );
}
