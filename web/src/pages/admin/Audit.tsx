import { useState } from "react";
import { useApi } from "../../lib/hooks";
import { qs } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { Denied, PageHead, PageLoader } from "../../components/ui";
import { dDate, dTime } from "../../lib/format";

export function Audit() {
  const [q, setQ] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const list = useApi<any[]>(`/admin/audit${qs({ q, from, to })}`, [q, from, to]);
  if (list.error?.status === 403) return <Denied />;
  return (
    <>
      <PageHead title="Journal d'audit" sub="Qui a fait quoi, et quand. Conservé dans la base, non modifiable depuis l'application.">
        <div className="search inline"><span className="search-ico"><Icon n="recherche" /></span><input placeholder="Action, utilisateur…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} /></div>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Du" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Au" />
      </PageHead>
      {!list.data ? <PageLoader /> : (
        <div className="card"><table className="table">
          <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Objet</th><th>Détails</th><th>Adresse</th></tr></thead>
          <tbody>
            {list.data.map((a) => <tr key={a.id}><td className="num-l">{dDate(a.at)} {dTime(a.at)}</td><td>{a.username ?? "-"}</td><td><b>{a.action}</b></td>
              <td className="muted">{a.entity ? `${a.entity}${a.entityId ? " #" + a.entityId : ""}` : "-"}</td><td className="muted">{a.details ?? ""}</td><td><code>{a.ip ?? ""}</code></td></tr>)}
            {!list.data.length && <tr><td colSpan={6} className="muted center">Aucune entrée</td></tr>}
          </tbody>
        </table></div>
      )}
    </>
  );
}
