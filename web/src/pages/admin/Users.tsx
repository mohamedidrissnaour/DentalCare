import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession, useLive } from "../../lib/session";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { useToasts } from "../../lib/toasts";
import { Icon } from "../../components/Icon";
import { Alerts, Denied, Modal, PageHead, PageLoader } from "../../components/ui";
import { dDayTime, dTime } from "../../lib/format";
import { Roles, roleLabel, userTitle, initials, fmtDateTime } from "../../../../shared/domain";

export function Users() {
  const { me, logout } = useSession();
  const toasts = useToasts();
  const nav = useNavigate();
  const list = useApi<any[]>("/admin/users");
  const [form, setForm] = useState<any>(null); const [err, setErr] = useState<string | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [resetPass, setResetPass] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<any>(null);
  useLive(["users"], () => list.reload());
  if (list.error?.status === 403) return <Denied />;
  if (!list.data || !me) return <PageLoader />;
  const act = async (fn: () => Promise<any>, ok: string) => { try { await fn(); toasts.success(ok); list.reload(); } catch (e: any) { toasts.error(e.message); } };
  const create = async () => { try { const r = await api.post("/admin/users", form); setTemp(r.tempPassword); list.reload(); } catch (e: any) { setErr(e.message); } };
  const now = fmtDateTime(new Date());
  const set = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));
  return (
    <>
      <PageHead title="Équipe & accès" sub="Seul le docteur principal crée les comptes des docteurs et des secrétaires, et gère leurs accès.">
        <button className="btn btn-primary" onClick={() => { setForm({ role: Roles.Secretaire, fullName: "", username: "", email: "", phone: "", rpps: "", specialty: "" }); setErr(null); setTemp(null); }}><Icon n="plus" /> Créer un compte</button>
      </PageHead>
      <div className="team-grid">
        {list.data.map((u) => {
          const locked = u.lockoutUntil && u.lockoutUntil > now;
          return (
            <div key={u.id} className={"member card" + (u.status === "Desactive" ? " disabled" : "")}>
              <div className="member-top">
                <span className="avatar lg" style={{ background: u.color }}>{initials(u.fullName)} {u.online && <i className="online" title="En ligne"></i>}</span>
                <div>
                  <b>{userTitle(u)}</b>
                  <span className={`role-tag role-${u.role.toLowerCase()}`}>{roleLabel(u.role)}</span>
                  <small>{u.username} {u.specialty ? "· " + u.specialty : ""}</small>
                  <small>Dernière connexion : {u.lastLoginAt ? dDayTime(u.lastLoginAt) : "jamais"}</small>
                  {locked && <span className="chip chip-red"><Icon n="cadenas" /> verrouillé jusqu'à {dTime(u.lockoutUntil)}</span>}
                  {u.status === "Desactive" && <span className="chip">désactivé</span>}
                  {u.mustChangePassword && <span className="chip chip-amber">mot de passe temporaire</span>}
                </div>
              </div>
              {u.id !== me.id ? (
                <div className="member-actions">
                  {u.role !== Roles.Principal && <select value={u.role} onChange={(e) => act(() => api.post(`/admin/users/${u.id}/role`, { role: e.target.value }), "Profil modifié : sessions de l'utilisateur fermées")}>
                    <option value={Roles.Docteur}>Docteur</option><option value={Roles.Secretaire}>Secrétaire</option></select>}
                  <button className="btn btn-sm" onClick={async () => { try { const r = await api.post(`/admin/users/${u.id}/reset`); setResetPass(r.tempPassword); list.reload(); } catch (e: any) { toasts.error(e.message); } }}><Icon n="cle" /> Réinitialiser</button>
                  {locked && <button className="btn btn-sm" onClick={() => act(() => api.post(`/admin/users/${u.id}/unlock`), "Compte déverrouillé")}><Icon n="cadenas" /> Déverrouiller</button>}
                  {u.status === "Actif"
                    ? <button className="btn btn-sm btn-danger-ghost" onClick={() => act(() => api.post(`/admin/users/${u.id}/status`, { status: "Desactive" }), "Compte désactivé, sessions fermées")}><Icon n="erreur" /> Désactiver</button>
                    : <button className="btn btn-sm" onClick={() => act(() => api.post(`/admin/users/${u.id}/status`, { status: "Actif" }), "Compte réactivé")}><Icon n="coche" /> Réactiver</button>}
                  {u.role === Roles.Docteur && u.status === "Actif" && <button className="btn btn-sm" onClick={() => setTransfer(u)}><Icon n="cle" /> Transférer le rôle principal</button>}
                </div>
              ) : <p className="muted">C'est vous.</p>}
            </div>
          );
        })}
      </div>

      <Modal open={!!form} onClose={() => { setForm(null); setTemp(null); }} title="Créer un compte" wide footer={temp === null
        ? <><button className="btn" onClick={() => setForm(null)}>Annuler</button><button className="btn btn-primary" onClick={create}>Créer</button></>
        : <button className="btn btn-primary" onClick={() => { setForm(null); setTemp(null); }}>J'ai noté le mot de passe</button>}>
        {temp !== null ? (
          <div className="temp-pass"><p>Compte créé <Icon n="valide" /> Communiquez ce mot de passe temporaire <b>de vive voix</b> (il ne sera plus affiché) :</p>
            <code className="big">{temp}</code><p className="hint">L'utilisateur devra le changer à sa première connexion.</p></div>
        ) : form && (
          <div className="form">
            <div className="seg">
              <button className={form.role === Roles.Docteur ? "on" : ""} onClick={() => set("role", Roles.Docteur)}><Icon n="consultation" /> Docteur</button>
              <button className={form.role === Roles.Secretaire ? "on" : ""} onClick={() => set("role", Roles.Secretaire)}>Secrétaire</button>
            </div>
            <div className="grid2">
              <label>Nom complet<input value={form.fullName} maxLength={80} onChange={(e) => set("fullName", e.target.value)} /></label>
              <label>Identifiant<input value={form.username} maxLength={32} onChange={(e) => set("username", e.target.value)} /></label>
              <label>E-mail<input value={form.email} maxLength={120} onChange={(e) => set("email", e.target.value)} /></label>
              <label>Téléphone<input value={form.phone} maxLength={20} onChange={(e) => set("phone", e.target.value)} /></label>
              {form.role === Roles.Docteur && <>
                <label>N° RPPS<input value={form.rpps} maxLength={11} onChange={(e) => set("rpps", e.target.value)} /></label>
                <label>Spécialité<input value={form.specialty} maxLength={60} onChange={(e) => set("specialty", e.target.value)} /></label>
              </>}
            </div>
            <Alerts errors={err} />
          </div>
        )}
      </Modal>
      <Modal open={!!resetPass} onClose={() => setResetPass(null)} title="Mot de passe réinitialisé">
        <div className="temp-pass"><p>Nouveau mot de passe temporaire :</p><code className="big">{resetPass}</code><p className="hint">À changer à la prochaine connexion. Toutes les sessions de cet utilisateur ont été fermées.</p></div>
      </Modal>
      <Modal open={!!transfer} onClose={() => setTransfer(null)} title="Transférer le rôle de docteur principal" footer={<>
        <button className="btn" onClick={() => setTransfer(null)}>Annuler</button>
        <button className="btn btn-danger" onClick={async () => { try { await api.post(`/admin/users/${transfer.id}/transfer`); await logout(); nav("/compte/connexion"); } catch (e: any) { toasts.error(e.message); } }}>Confirmer le transfert</button>
      </>}>
        <p>Le <b>Dr {transfer?.fullName}</b> deviendra docteur principal (administrateur). Vous deviendrez docteur. Vous serez déconnecté.</p>
      </Modal>
    </>
  );
}
