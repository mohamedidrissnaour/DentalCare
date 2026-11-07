import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "./lib/toasts";
import { SessionProvider, useSession } from "./lib/session";
import { Layout } from "./components/Layout";
import { PageLoader } from "./components/ui";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Queue } from "./pages/Queue";
import { Agenda } from "./pages/Agenda";
import { Patients } from "./pages/Patients";
import { PatientDetail } from "./pages/PatientDetail";
import { RxList } from "./pages/RxList";
import { RxEdit } from "./pages/RxEdit";
import { RxDetail } from "./pages/RxDetail";
import { Billing } from "./pages/Billing";
import { Cash } from "./pages/Cash";
import { Recalls } from "./pages/Recalls";
import { Notifications } from "./pages/Notifications";
import { Profile } from "./pages/Profile";
import { Pilotage } from "./pages/Pilotage";
import { Users } from "./pages/admin/Users";
import { Permissions } from "./pages/admin/Permissions";
import { Settings } from "./pages/admin/Settings";
import { Supervision } from "./pages/admin/Supervision";
import { Logs } from "./pages/admin/Logs";
import { Audit } from "./pages/admin/Audit";
import { Backups } from "./pages/admin/Backups";
import { PrintRx, PrintInvoice, PrintCash } from "./pages/print/Print";
import { Empty } from "./components/ui";

function Guard({ children }: { children: React.ReactNode }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <div className="page-loader full"><PageLoader text="Chargement de DentaCare…" /></div>;
  if (!me) return <Navigate to={`/compte/connexion?retour=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Routes>
          <Route path="/compte/connexion" element={<Login />} />
          <Route path="/impression/ordonnance/:id" element={<Guard><PrintRx /></Guard>} />
          <Route path="/impression/facture/:id" element={<Guard><PrintInvoice /></Guard>} />
          <Route path="/impression/caisse" element={<Guard><PrintCash /></Guard>} />
          <Route element={<Guard><Layout /></Guard>}>
            <Route index element={<Home />} />
            <Route path="file-attente" element={<Queue />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="patients" element={<Patients />} />
            <Route path="patients/:id" element={<PatientDetail />} />
            <Route path="ordonnances" element={<RxList />} />
            <Route path="ordonnances/nouvelle" element={<RxEdit />} />
            <Route path="ordonnances/:id/modifier" element={<RxEdit />} />
            <Route path="ordonnances/:id" element={<RxDetail />} />
            <Route path="facturation" element={<Billing />} />
            <Route path="caisse" element={<Cash />} />
            <Route path="rappels" element={<Recalls />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="profil" element={<Profile />} />
            <Route path="pilotage" element={<Pilotage />} />
            <Route path="admin/utilisateurs" element={<Users />} />
            <Route path="admin/permissions" element={<Permissions />} />
            <Route path="admin/parametres" element={<Settings />} />
            <Route path="admin/supervision" element={<Supervision />} />
            <Route path="admin/journaux" element={<Logs />} />
            <Route path="admin/audit" element={<Audit />} />
            <Route path="admin/sauvegardes" element={<Backups />} />
            <Route path="*" element={<Empty icon="info" title="Page introuvable"><a className="btn btn-primary" href="/">Retour à l'accueil</a></Empty>} />
          </Route>
        </Routes>
      </SessionProvider>
    </ToastProvider>
  );
}
