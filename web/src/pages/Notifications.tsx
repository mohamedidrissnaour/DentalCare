import { Link } from "react-router-dom";
import { useSession, useLive } from "../lib/session";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { Icon, notifIcon } from "../components/Icon";
import { PageHead, PageLoader } from "../components/ui";
import { dDate, dTime } from "../lib/format";

export function Notifications() {
  const { refresh } = useSession();
  const items = useApi<any[]>("/notifications");
  useLive(["notifications"], () => items.reload());
  if (!items.data) return <PageLoader />;
  const read = async (id?: number) => { await api.post("/notifications/read", id ? { id } : {}); items.reload(); refresh(); };
  return (
    <>
      <PageHead title="Notifications" sub={`${items.data.filter((n) => !n.readAt).length} non lue(s)`}>
        <button className="btn" onClick={() => read()}><Icon n="coche" /> Tout marquer comme lu</button>
      </PageHead>
      <div className="card"><div className="notif-list big">
        {items.data.map((n) => (
          <Link key={n.id} className={"notif" + (n.readAt ? "" : " unread")} to={n.link ?? "#"} onClick={() => read(n.id)}>
            <span className="notif-ico"><Icon n={notifIcon(n.kind)} /></span>
            <span><b>{n.title}</b><small>{n.message}</small><em>{dDate(n.createdAt)} {dTime(n.createdAt)} {n.createdByName ? "· " + n.createdByName : ""}</em></span>
          </Link>
        ))}
        {!items.data.length && <div className="empty-mini">Aucune notification</div>}
      </div></div>
    </>
  );
}
