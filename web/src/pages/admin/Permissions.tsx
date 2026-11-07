import { useState } from "react";
import { useLive } from "../../lib/session";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { useToasts } from "../../lib/toasts";
import { Icon } from "../../components/Icon";
import { Denied, Modal, PageHead, PageLoader } from "../../components/ui";
import { Roles, roleLabel, permDefault } from "../../../../shared/domain";

export function Permissions() {
  const toasts = useToasts();
  const list = useApi<any[]>("/admin/permissions");
  const [confirm, setConfirm] = useState(false);
  useLive(["permissions"], () => list.reload());
  if (list.error?.status === 403) return <Denied />;
  if (!list.data) return <PageLoader />;
  const set = async (role: string, p: any, allowed: boolean) => {
    try { await api.post("/admin/permissions", { role, key: p.key, allowed }); toasts.success(allowed ? "Permission accordée" : "Permission retirée", `${roleLabel(role)} · ${p.label}`); list.reload(); }
    catch (e: any) { toasts.error("Modification impossible", e.message); }
  };
  const Toggle = ({ role, p }: { role: string; p: any }) => {
    const on = p.values[role], def = permDefault(role, p.key), custom = p.custom[role] && on !== def;
    return (
      <label className="switch perm-switch" title={custom ? `Modifié (valeur par défaut : ${def ? "autorisé" : "refusé"})` : "Valeur par défaut"}>
        <input type="checkbox" checked={on} onChange={(e) => set(role, p, e.target.checked)} /><span></span>
        <em className={on ? "on" : "off"}>{on ? "Autorisé" : "Refusé"}</em>
        {custom && <i className="perm-dot" aria-label="modifié"></i>}
      </label>
    );
  };
  const groups = [...new Set(list.data.map((p) => p.group))];
  return (
    <>
      <PageHead title="Rôles & permissions" sub="Choisissez ce que chaque profil peut faire. Les changements s'appliquent immédiatement sur tous les postes et sont tracés dans l'audit.">
        <button className="btn" onClick={() => setConfirm(true)}><Icon n="actualiser" /> Rétablir les valeurs par défaut</button>
      </PageHead>
      <div className="alert alert-info"><Icon n="info" /> Le docteur principal a toujours toutes les permissions. Les actes médicaux (prescrire, mener une consultation) ne peuvent pas être accordés à une secrétaire.</div>
      {groups.map((g) => (
        <div className="card flush perm-card" key={g}>
          <header className="card-head"><h3>{g}</h3></header>
          <table className="table perm-table">
            <thead><tr><th>Permission</th><th className="center" style={{ width: 150 }}>Docteur principal</th><th className="center" style={{ width: 150 }}>Docteurs</th><th className="center" style={{ width: 170 }}>Secrétaires</th></tr></thead>
            <tbody>{list.data!.filter((p) => p.group === g).map((p) => (
              <tr key={p.key}>
                <td><b>{p.label}</b><small className="block muted">{p.help}</small></td>
                <td className="center"><span className="perm-fixed" title="Toujours autorisé"><Icon n="coche" /></span></td>
                <td className="center"><Toggle role={Roles.Docteur} p={p} /></td>
                <td className="center">{p.clinicalOnly ? <span className="chip">Réservé aux praticiens</span> : <Toggle role={Roles.Secretaire} p={p} />}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      <div className="card"><h3>Réservé au docteur principal (non délégable)</h3>
        <p className="muted">Création et désactivation des comptes, rôles & permissions, paramètres du cabinet et tarifs, supervision technique, journaux, audit, sauvegardes, mode maintenance, données de démonstration.</p></div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Rétablir les permissions par défaut ?" footer={<>
        <button className="btn" onClick={() => setConfirm(false)}>Annuler</button>
        <button className="btn btn-primary" onClick={async () => { await api.post("/admin/permissions/reset"); setConfirm(false); toasts.success("Permissions rétablies"); list.reload(); }}>Rétablir</button>
      </>}><p>Toutes les personnalisations seront supprimées et chaque profil retrouvera ses droits d'origine.</p></Modal>
    </>
  );
}
