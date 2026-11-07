import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Icon, Logo } from "../components/Icon";
import { api } from "../lib/api";
import { useSession } from "../lib/session";

export function Login() {
  const { me, refresh } = useSession();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [state, setState] = useState<{ initialPending: boolean; cabinet: string } | null>(null);
  const [u, setU] = useState(""); const [p, setP] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = "Connexion - DentaCare"; api.get("/auth/state").then(setState).catch(() => undefined); }, []);
  if (me) return <Navigate to={me.mustChangePassword ? "/profil?force=1" : "/"} replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await api.post("/auth/login", { username: u, password: p });
      await refresh();
      const back = params.get("retour");
      nav(r.mustChange ? "/profil?force=1" : back && back.startsWith("/") && !back.startsWith("//") ? back : "/", { replace: true });
    } catch (ex: any) { setErr(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <div className="auth-logo"><Logo /> <span>DentaCare</span></div>
        <div className="auth-pitch">
          <h1>La gestion du cabinet,<br />claire et sans friction.</h1>
          <ul>
            <li><Icon n="valide" /> File d'attente et agenda multi-praticiens</li>
            <li><Icon n="valide" /> Dossier patient, soins et règlements</li>
            <li><Icon n="valide" /> Ordonnances transmises au secrétariat en un clic</li>
          </ul>
        </div>
        <p className="auth-foot-note">Fonctionne hors ligne, sur le réseau local du cabinet.</p>
      </aside>
      <main className="auth-panel">
        <div className="auth-card">
          <div><h2>Connexion</h2><p className="muted">{state?.cabinet ?? ""}</p></div>
          {err && <div className="alert alert-error"><Icon n="erreur" /> {err}</div>}
          {state?.initialPending && <div className="alert alert-info"><Icon n="cle" /> Premier démarrage : comptes « docteur » et « secretaire » créés. Les mots de passe temporaires sont affichés dans la console du poste serveur et dans le fichier <code>identifiants-initiaux.txt</code> du dossier de données.</div>}
          <form className="form" onSubmit={submit}>
            <label>Identifiant<input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required maxLength={32} /></label>
            <label>Mot de passe<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" required maxLength={128} /></label>
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
          </form>
          <div className="auth-foot"><span>Pas de compte ? Demandez-le au docteur principal.</span><span>v4.0</span></div>
        </div>
      </main>
    </div>
  );
}
