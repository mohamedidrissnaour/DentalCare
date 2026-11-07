import { useEffect, useState } from "react";
import { useApi } from "../../lib/hooks";
import { qs } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { Denied, PageHead, PageLoader } from "../../components/ui";

const LEVELS: [string, string][] = [["debug", "Tout"], ["info", "Info"], ["warn", "Avertissements"], ["error", "Erreurs"]];

export function Logs() {
  const [level, setLevel] = useState("info");
  const [q, setQ] = useState("");
  const [live, setLive] = useState(true);
  const list = useApi<any[]>(`/admin/logs${qs({ level, q })}`, [level, q]);
  const files = useApi<any[]>("/admin/logs/files");
  useEffect(() => { if (!live) return; const t = setInterval(() => list.reload(), 3000); return () => clearInterval(t); }, [live, list.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  if (list.error?.status === 403) return <Denied />;
  return (
    <>
      <PageHead title="Journaux techniques" sub={<>Flux en direct (JSON Lines dans <code>logs</code>, un fichier par jour). Aucune donnée patient n'y est écrite.</>}>
        <label className="check"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Direct <span className={"live-dot" + (live ? "" : " off")}></span></label>
        {files.data?.[0] && <a className="btn" href={`/api/admin/logs/files/${files.data[0].name}`}><Icon n="telecharger" /> Journal du jour</a>}
      </PageHead>
      <div className="filters">
        {LEVELS.map(([k, l]) => <button key={k} className={`pill lvl-${k}` + (level === k ? " on" : "")} onClick={() => setLevel(k)}>{l}</button>)}
        <div className="search inline"><span className="search-ico"><Icon n="recherche" /></span><input placeholder="Filtrer…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} /></div>
      </div>
      {!list.data ? <PageLoader /> : (
        <div className="card logs"><table className="table mono">
          <thead><tr><th>Heure</th><th>Niveau</th><th>Source</th><th>Message</th></tr></thead>
          <tbody>{list.data.map((e, i) => (
            <tr key={i} className={`log-${e.level}`}>
              <td>{e.at.slice(11)}</td><td><span className={`lvl lvl-${e.level}`}>{e.level}</span></td><td>{e.category}</td>
              <td>{e.message}{e.exception && <div className="ex">{e.exception}</div>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="card"><h3>Fichiers</h3><ul className="mini-list">
        {(files.data ?? []).slice(0, 15).map((f) => <li key={f.name}><a href={`/api/admin/logs/files/${f.name}`}><code>{f.name}</code></a><span>{Math.round(f.size / 1024)} Ko</span></li>)}
      </ul></div>
    </>
  );
}
