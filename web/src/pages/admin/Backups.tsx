import { useState } from "react";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { useToasts } from "../../lib/toasts";
import { Icon } from "../../components/Icon";
import { Denied, PageHead, PageLoader } from "../../components/ui";
import { dDayTime } from "../../lib/format";

export function Backups() {
  const toasts = useToasts();
  const d = useApi<any>("/admin/backups");
  const [busy, setBusy] = useState(false);
  if (d.error?.status === 403) return <Denied />;
  if (!d.data) return <PageLoader />;
  return (
    <>
      <PageHead title="Sauvegardes" sub="Copie complète de la base : automatique chaque jour, et à la demande.">
        <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api.post("/admin/backups"); toasts.success("Sauvegarde réalisée", r.file); d.reload(); } catch (e: any) { toasts.error(e.message); } finally { setBusy(false); } }}>
          <Icon n="sauvegarde" /> {busy ? "Sauvegarde…" : "Sauvegarder maintenant"}</button>
      </PageHead>
      <div className="alert alert-info"><Icon n="info" /> Dossier : <code>{d.data.folder}</code>. Copiez régulièrement ces fichiers sur un support externe chiffré (clé USB, NAS du cabinet). Pour restaurer : arrêter DentaCare, remplacer <code>dentacare.db</code> par la sauvegarde, relancer.</div>
      <div className="card"><table className="table">
        <thead><tr><th>Fichier</th><th>Date</th><th className="num">Taille</th><th></th></tr></thead>
        <tbody>
          {d.data.files.map((f: any) => <tr key={f.name}><td><code>{f.name}</code></td><td>{dDayTime(f.modified)}</td><td className="num">{Math.round(f.size / 1024)} Ko</td>
            <td><a className="btn btn-sm" href={`/api/admin/backups/${f.name}`}><Icon n="telecharger" /> Télécharger</a></td></tr>)}
          {!d.data.files.length && <tr><td colSpan={4} className="muted center">Aucune sauvegarde pour le moment</td></tr>}
        </tbody>
      </table></div>
    </>
  );
}
