import { useEffect, useRef, useState } from "react";
import { NavLink, Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Icon, Logo, notifIcon } from "./Icon";
import { useSession, useLive } from "../lib/session";
import { api } from "../lib/api";
import { toggleTheme } from "../lib/desktop";
import { ago } from "../lib/format";
import { P, Roles, roleLabel, userTitle, initials } from "../../../shared/domain";

function NavMenu({ onToggle }: { onToggle: () => void }) {
  const { me, can, cabinet, queue, rxToPrint } = useSession();
  if (!me) return null;
  const L = ({ to, icon, label, end, badge, blue }: { to: string; icon: string; label: string; end?: boolean; badge?: number; blue?: boolean }) => (
    <NavLink to={to} end={end}><i><Icon n={icon} /></i><span>{label}</span>{!!badge && <em className={"nav-badge" + (blue ? " blue" : "")}>{badge}</em>}</NavLink>
  );
  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo />
        <div className="brand-txt"><b>DentaCare</b><small>{cabinet}</small></div>
        <button className="icon-btn collapse-btn" title="Réduire le menu" onClick={onToggle}><Icon n="chevron-gauche" /></button>
      </div>
      <div className="side-profile">
        <span className="avatar lg" style={{ background: me.color }}>{initials(me.fullName)}</span>
        <b>{userTitle(me)}</b><small>{roleLabel(me.role)}</small>
      </div>
      <nav>
        <div className="nav-group">Cabinet</div>
        <L to="/" end icon="tableau-de-bord" label="Tableau de bord" />
        <L to="/file-attente" icon="salle-attente" label="File d'attente" badge={queue.waiting} blue />
        <L to="/agenda" icon="calendrier" label="Agenda" />
        <L to="/patients" icon="patients" label="Patients" />
        {can(P.AgendaEdit) && <L to="/rappels" icon="telephone" label="Patients à rappeler" />}
        <div className="nav-group">Soins & documents</div>
        {can(P.RxWrite) && <L to="/ordonnances/nouvelle" end icon="crayon" label="Nouvelle ordonnance" />}
        <L to="/ordonnances" end icon="ordonnance" label="Ordonnances" badge={rxToPrint} />
        <L to="/facturation" icon="euro" label="Facturation" />
        {can(P.BillingCollect) && <L to="/caisse" icon="journal" label="Journal de caisse" />}
        <L to="/notifications" icon="cloche" label="Notifications" />
        {me.role === Roles.Principal ? (
          <>
            <div className="nav-group">Administration</div>
            <L to="/pilotage" icon="supervision" label="Pilotage du cabinet" />
            <L to="/admin/utilisateurs" icon="equipe" label="Équipe & accès" />
            <L to="/admin/permissions" icon="cle" label="Rôles & permissions" />
            <L to="/admin/parametres" icon="reglages" label="Paramètres" />
            <L to="/admin/supervision" icon="serveur" label="Supervision technique" />
            <L to="/admin/journaux" icon="journal" label="Journaux" />
            <L to="/admin/audit" icon="bouclier" label="Audit" />
            <L to="/admin/sauvegardes" icon="sauvegarde" label="Sauvegardes" />
          </>
        ) : (can(P.PilotageOwn) || can(P.PilotageAll)) && (
          <>
            <div className="nav-group">Indicateurs</div>
            <L to="/pilotage" icon="supervision" label={can(P.PilotageAll) ? "Pilotage du cabinet" : "Mes indicateurs"} />
          </>
        )}
      </nav>
      <Link className="side-queue" to="/file-attente">
        <span className="sq-ico"><Icon n="salle-attente" size={18} /></span>
        <span><small>Salle d'attente</small><b>{queue.waiting} en attente · {queue.inCare} en soin</b></span>
      </Link>
    </aside>
  );
}

export function Layout() {
  const { me, unread, logout, refresh, ref } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [ring, setRing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadNotifs = () => api.get("/notifications").then((l) => setRecent(l.slice(0, 12))).catch(() => undefined);
  useEffect(() => { loadNotifs(); }, []);
  useLive(["notifications"], () => { loadNotifs(); setRing(true); setTimeout(() => setRing(false), 1500); });
  useEffect(() => { setPanel(false); setUserMenu(false); }, [loc.pathname]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { if (me?.mustChangePassword && loc.pathname !== "/profil") nav("/profil?force=1"); }, [me?.mustChangePassword, loc.pathname, nav]);

  if (!me) return null;
  const read = async (n: any) => { await api.post("/notifications/read", { id: n.id }); setPanel(false); loadNotifs(); refresh(); };
  const readAll = async () => { await api.post("/notifications/read", {}); loadNotifs(); refresh(); };
  const maintenance = ref?.settings?.maintenanceMode;
  return (
    <div className={"shell" + (collapsed ? " collapsed" : "")}>
      <NavMenu onToggle={() => setCollapsed((c) => !c)} />
      <div className="main">
        <header className="topbar">
          <form className="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) nav(`/patients?q=${encodeURIComponent(q.trim())}`); }}>
            <span className="search-ico"><Icon n="recherche" /></span>
            <input ref={searchRef} placeholder="Rechercher un patient (nom, téléphone, n° dossier)…" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} aria-label="Recherche patient" />
            <kbd>Ctrl K</kbd>
          </form>
          <div className="top-actions">
            <span className="clock">{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
            <button className="icon-btn" title="Thème clair / sombre" onClick={toggleTheme}><Icon n="lune" /></button>
            <div className="bell-wrap">
              <button className={"icon-btn bell" + (ring ? " ring" : "")} title="Notifications" onClick={() => setPanel((p) => !p)}>
                <Icon n="cloche" size={18} /> {unread > 0 && <span className="badge">{unread}</span>}
              </button>
              {panel && (
                <div className="notif-panel fade-down">
                  <header><b>Notifications</b><button className="link" onClick={readAll}>Tout marquer comme lu</button></header>
                  <div className="notif-list">
                    {recent.map((n) => (
                      <Link key={n.id} className={"notif" + (n.readAt ? "" : " unread")} to={n.link ?? "/notifications"} onClick={() => read(n)}>
                        <span className="notif-ico"><Icon n={notifIcon(n.kind)} /></span>
                        <span><b>{n.title}</b><small>{n.message}</small><em>{ago(n.createdAt)}</em></span>
                      </Link>
                    ))}
                    {!recent.length && <div className="muted pad">Aucune notification</div>}
                  </div>
                  <Link className="notif-all" to="/notifications">Voir tout →</Link>
                </div>
              )}
            </div>
            <div className="user-chip" onClick={() => setUserMenu((u) => !u)}>
              <span className="avatar" style={{ background: me.color }}>{initials(me.fullName)}</span>
              <span className="who"><b>{userTitle(me)}</b><small>{roleLabel(me.role)}</small></span>
              {userMenu && (
                <div className="user-menu fade-down" onClick={(e) => e.stopPropagation()}>
                  <Link to="/profil"><Icon n="utilisateur" /> Mon profil</Link>
                  <Link to="/notifications"><Icon n="cloche" /> Notifications</Link>
                  <button type="button" onClick={async () => { await logout(); nav("/compte/connexion"); }}><Icon n="deconnexion" /> Déconnexion</button>
                </div>
              )}
            </div>
          </div>
        </header>
        {maintenance && me.role !== Roles.Principal ? (
          <div className="empty-state"><div className="empty-icon"><Icon n="reglages" /></div><h2>Maintenance en cours</h2><p>Le docteur principal effectue une opération de maintenance. Merci de patienter quelques minutes.</p></div>
        ) : (
          <>
            {maintenance && <div className="maint-banner"><Icon n="reglages" /> Mode maintenance actif : vous seul avez accès à l'application.</div>}
            <main className="content page-enter" key={loc.pathname}><Outlet /></main>
          </>
        )}
      </div>
    </div>
  );
}
