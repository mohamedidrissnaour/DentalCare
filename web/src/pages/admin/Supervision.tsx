import { Fragment, useEffect } from "react";
import { useApi } from "../../lib/hooks";
import { Icon } from "../../components/Icon";
import { Denied, PageHead, PageLoader } from "../../components/ui";
import { Sparkline } from "../../components/charts";
import { dDayTime, dTime } from "../../lib/format";
import { roleLabel } from "../../../../shared/domain";

const LABELS: Record<string, string> = { patients: "Patients", appointments: "Rendez-vous", prescriptions: "Ordonnances", invoices: "Factures", users: "Comptes", audit_log: "Entrées d'audit" };
const uptime = (s: number) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };

export function Supervision() {
  const d = useApi<any>("/admin/supervision");
  useEffect(() => { const t = setInterval(() => d.reload(), 5000); return () => clearInterval(t); }, [d.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  if (d.error?.status === 403) return <Denied />;
  if (!d.data) return <PageLoader />;
  const x = d.data, last = x.last;
  const backupAgeH = x.lastBackup ? (Date.now() - new Date(x.lastBackup).getTime()) / 3600000 : null;
  const checks = [
    { name: "Base de données", ok: x.dbCheck, warn: false, detail: x.dbCheck ? "Intégrité OK" : "Vérification en échec" },
    { name: "Sauvegarde", ok: backupAgeH !== null && backupAgeH < 26, warn: backupAgeH !== null, detail: x.lastBackup ? `Dernière : ${dDayTime(x.lastBackup)}` : "Aucune sauvegarde" },
    { name: "Erreurs", ok: x.errors === 0, warn: x.errors < 10, detail: `${x.errors} erreur(s) depuis le démarrage` },
    { name: "Mémoire", ok: (last?.memoryMb ?? 0) < 600, warn: true, detail: `${last?.memoryMb ?? "-"} Mo` },
  ];
  return (
    <>
      <PageHead title="Supervision" sub={<>Santé du système en temps réel, rafraîchissement toutes les 5 s <span className="live-dot"></span></>}>
        <a className="btn" href="/metrics" target="_blank" rel="noreferrer"><Icon n="supervision" /> /metrics (Prometheus)</a>
        <a className="btn" href="/health" target="_blank" rel="noreferrer">/health</a>
      </PageHead>
      <section className="health-strip">{checks.map((c) => (
        <div key={c.name} className={"health " + (c.ok ? "ok" : c.warn ? "warn" : "ko")}><i><Icon n={c.ok ? "valide" : c.warn ? "alerte" : "erreur"} size={18} /></i><div><b>{c.name}</b><small>{c.detail}</small></div></div>
      ))}</section>
      <section className="kpis">
        <div className="kpi"><i><Icon n="horloge" /></i><div><small>Disponibilité</small><b>{uptime(x.uptimeSec)}</b><em>depuis {dDayTime(String(x.startedAt).replace("Z", ""))}</em></div></div>
        <div className="kpi"><i><Icon n="patients" /></i><div><small>Utilisateurs en ligne</small><b>{x.online.length}</b><em>{x.tabs} fenêtre(s) ouvertes</em></div></div>
        <div className="kpi"><i><Icon n="reseau" /></i><div><small>Requêtes HTTP</small><b>{x.requests}</b><em>{x.r4xx} × 4xx · {x.r5xx} × 5xx</em></div></div>
        <div className="kpi"><i><Icon n="supervision" /></i><div><small>Latence moyenne</small><b>{x.avgLatencyMs.toFixed(1)} ms</b></div></div>
        <div className="kpi"><i><Icon n="sauvegarde" /></i><div><small>Base de données</small><b>{(x.dbBytes / 1048576).toFixed(1)} Mo</b></div></div>
        <div className={"kpi" + (x.errors > 0 ? " warn" : "")}><i><Icon n="journal" /></i><div><small>Journal</small><b>{x.errors} erreur(s)</b><em>{x.warnings} avertissement(s)</em></div></div>
      </section>
      <section className="grid-dash">
        <div className="card"><header className="card-head"><h3>CPU</h3><b>{last?.cpuPercent ?? "-"} %</b></header><Sparkline values={x.history.map((h: any) => h.cpuPercent)} max={100} color="#14B1BB" /></div>
        <div className="card"><header className="card-head"><h3>Mémoire</h3><b>{last?.memoryMb ?? "-"} Mo</b></header><Sparkline values={x.history.map((h: any) => h.memoryMb)} color="#1BAE7E" /></div>
        <div className="card"><header className="card-head"><h3>Latence</h3><b>{last?.avgLatencyMs ?? "-"} ms</b></header><Sparkline values={x.history.map((h: any) => h.avgLatencyMs)} color="#FCBF64" /></div>
        <div className="card"><h3>Connectés maintenant</h3><ul className="mini-list">
          {x.online.map((o: any) => <li key={o.id}><b>{o.userName}</b> <small>{roleLabel(o.role)}</small><em className="muted">depuis {dTime(o.connectedAt)}</em></li>)}
          {!x.online.length && <li className="muted">Personne</li>}
        </ul></div>
        <div className="card"><h3>Pages les plus utilisées</h3><ul className="mini-list">{x.routes.slice(0, 8).map(([k, v]: [string, number]) => <li key={k}><code>{k}</code><b>{v}</b></li>)}</ul></div>
        <div className="card"><h3>Activité métier</h3><dl className="dl">
          <dt>Connexions réussies / échouées</dt><dd>{x.loginSuccess} / {x.loginFailure}</dd>
          <dt>Ordonnances envoyées / imprimées</dt><dd>{x.rxSent} / {x.rxPrinted}</dd>
          {Object.entries(x.counts).map(([k, v]) => <Fragment key={k}><dt>{LABELS[k] ?? k}</dt><dd>{String(v)}</dd></Fragment>)}
        </dl></div>
        <div className="card span2"><h3>Serveur</h3><dl className="dl two">
          <dt>Poste serveur</dt><dd>{x.host}</dd><dt>Système</dt><dd>{x.platform}</dd><dt>Node.js</dt><dd>{x.node}</dd>
          <dt>Données</dt><dd><code>{x.dataDir}</code></dd>
          <dt>Adresses pour les autres postes</dt><dd>{x.lanUrls.map((u: string) => <code key={u} className="url">{u}</code>)}</dd>
        </dl></div>
      </section>
    </>
  );
}
